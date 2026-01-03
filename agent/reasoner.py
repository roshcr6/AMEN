"""
AMEN - LLM Reasoner
Uses Google Gemini via the google-genai SDK
"""

import json
from typing import Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum
import structlog
from google import genai
from google.genai import types

from config import AgentConfig


logger = structlog.get_logger()


class ThreatClassification(Enum):
    """Threat classification types"""
    NATURAL = "NATURAL"
    ORACLE_MANIPULATION = "ORACLE_MANIPULATION"
    FLASH_LOAN_ATTACK = "FLASH_LOAN_ATTACK"


@dataclass
class ThreatAssessment:
    """
    Structured threat assessment from LLM
    
    This is the ONLY output format accepted from the LLM.
    Any free-form text is rejected.
    """
    classification: ThreatClassification
    confidence: float  # 0.0 - 1.0
    explanation: str
    evidence: list[str]
    raw_response: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "classification": self.classification.value,
            "confidence": self.confidence,
            "explanation": self.explanation,
            "evidence": self.evidence
        }


# System prompt for Gemini - enforces strict JSON output
SYSTEM_PROMPT = """You are a DeFi Security Analyst AI. Your ONLY task is to analyze blockchain market data and detect potential manipulation attacks.

ATTACK PATTERNS YOU MUST DETECT:

1. FLASH_LOAN_ATTACK:
   - Large sudden price movements (>10% in single block)
   - Price recovers quickly (within 1-2 blocks)
   - Multiple large swaps in same block
   - Liquidations occurring during price dip
   - Oracle price deviates significantly from AMM price

2. ORACLE_MANIPULATION:
   - Oracle price differs from AMM spot price by >5%
   - Multiple oracle updates in same block
   - Oracle price change doesn't match market activity
   - Liquidations at manipulated prices

3. NATURAL:
   - Normal market volatility
   - Price changes consistent with trading volume
   - No unusual patterns

CRITICAL RULES:
- You MUST respond with ONLY valid JSON
- NO markdown code blocks
- NO explanatory text outside JSON
- Confidence must be 0.0-1.0
- Evidence must be specific data points

REQUIRED OUTPUT FORMAT (strict JSON only):
{
  "classification": "NATURAL" | "ORACLE_MANIPULATION" | "FLASH_LOAN_ATTACK",
  "confidence": <float 0.0-1.0>,
  "explanation": "<clear explanation of reasoning>",
  "evidence": ["<specific evidence 1>", "<specific evidence 2>", ...]
}"""


class Reasoner:
    """
    LLM-powered threat reasoning engine
    
    Uses Google Gemini to analyze market data and produce
    structured threat assessments.
    
    CRITICAL: LLM is called ONLY when anomalies are detected.
    Block-level deduplication prevents duplicate calls for same events.
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        
        # Initialize Google Genai client
        try:
            self.client = genai.Client(api_key=config.gemini_api_key)
            self.model_name = config.gemini_model
            
            logger.info("Google Genai initialized", model=self.model_name)
        except Exception as e:
            logger.error("Failed to initialize Google Genai", error=str(e))
            raise ValueError(f"Google Genai initialization failed: {e}")
        
        # LLM call tracking for deduplication
        self.last_llm_block: int = 0
        self.last_llm_call_hash: Optional[str] = None
        self.llm_calls_count: int = 0
        self.blocks_processed: int = 0
        
        # Static state tracking (for idle testnet detection)
        self.last_prices = []  # Track last N prices to detect static state
        self.static_state_warnings = 0
        
        # Event cache to avoid re-analyzing same events
        self.analyzed_events: set = set()  # Set of event hashes
        
        logger.info("Reasoner initialized", model=config.gemini_model)
    
    def _build_analysis_prompt(self, context: Dict[str, Any]) -> str:
        """Build the analysis prompt with current market data"""
        return f"""{SYSTEM_PROMPT}

CURRENT MARKET DATA:
{json.dumps(context, indent=2)}

Analyze this data for potential manipulation attacks. Respond with JSON only."""

    def _parse_response(self, response_text: str) -> ThreatAssessment:
        """
        Parse LLM response into structured ThreatAssessment
        
        Enforces strict JSON format - rejects any free-form text.
        """
        # Clean response
        text = response_text.strip()
        
        # Remove markdown code blocks if present
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            logger.error("Failed to parse LLM response as JSON", 
                        response=response_text[:200],
                        error=str(e))
            # Return safe default
            return ThreatAssessment(
                classification=ThreatClassification.NATURAL,
                confidence=0.0,
                explanation="Failed to parse LLM response",
                evidence=["Parse error: " + str(e)],
                raw_response=response_text
            )
        
        # Validate required fields
        required_fields = ["classification", "confidence", "explanation", "evidence"]
        for field in required_fields:
            if field not in data:
                logger.error("Missing required field in LLM response", field=field)
                return ThreatAssessment(
                    classification=ThreatClassification.NATURAL,
                    confidence=0.0,
                    explanation=f"Missing field: {field}",
                    evidence=[],
                    raw_response=response_text
                )
        
        # Parse classification
        try:
            classification = ThreatClassification(data["classification"])
        except ValueError:
            logger.error("Invalid classification", value=data["classification"])
            classification = ThreatClassification.NATURAL
        
        # Validate confidence
        confidence = float(data["confidence"])
        if confidence < 0 or confidence > 1:
            logger.warning("Confidence out of range, clamping", value=confidence)
            confidence = max(0.0, min(1.0, confidence))
        
        # Ensure evidence is a list
        evidence = data["evidence"]
        if not isinstance(evidence, list):
            evidence = [str(evidence)]
        
        return ThreatAssessment(
            classification=classification,
            confidence=confidence,
            explanation=str(data["explanation"]),
            evidence=[str(e) for e in evidence],
            raw_response=response_text
        )

    async def analyze(self, context: Dict[str, Any]) -> ThreatAssessment:
        """
        Analyze market context for potential threats
        
        CRITICAL: This function calls the LLM (costs money, has rate limits).
        Only call this if quick_check() returns True AND no duplicate.
        
        Args:
            context: Structured market data from Observer
            
        Returns:
            ThreatAssessment with classification and confidence
        """
        current_block = context.get("current_state", {}).get("block_number", 0)
        
        # DEDUPLICATION: Don't analyze same block multiple times
        if current_block == self.last_llm_block:
            logger.warning(
                "Skipping LLM call - already analyzed this block",
                block=current_block,
                last_analyzed=self.last_llm_block
            )
            return ThreatAssessment(
                classification=ThreatClassification.NATURAL,
                confidence=0.0,
                explanation="Block already analyzed (deduplication)",
                evidence=[]
            )
        
        # Generate content hash for deduplication
        import hashlib
        content_hash = hashlib.sha256(
            json.dumps(context, sort_keys=True).encode()
        ).hexdigest()[:16]
        
        if content_hash == self.last_llm_call_hash:
            logger.warning(
                "Skipping LLM call - identical context",
                block=current_block,
                hash=content_hash
            )
            return ThreatAssessment(
                classification=ThreatClassification.NATURAL,
                confidence=0.0,
                explanation="Identical context already analyzed",
                evidence=[]
            )
        
        prompt = self._build_analysis_prompt(context)
        
        try:
            # Track LLM call
            self.llm_calls_count += 1
            self.last_llm_block = current_block
            self.last_llm_call_hash = content_hash
            
            logger.info(
                "🤖 CALLING GEMINI LLM",
                block=current_block,
                total_llm_calls=self.llm_calls_count,
                blocks_processed=self.blocks_processed
            )
            
            # Generate response with Google Genai
            generation_config = types.GenerateContentConfig(
                temperature=0.1,
                top_p=0.8,
                top_k=40,
                max_output_tokens=1024,
            )
            
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=generation_config
            )
            
            if not response.text:
                logger.error("Empty response from Gemini")
                return ThreatAssessment(
                    classification=ThreatClassification.NATURAL,
                    confidence=0.0,
                    explanation="Empty LLM response",
                    evidence=[]
                )
            
            logger.debug("Received Gemini response", length=len(response.text))
            
            # Parse into structured assessment
            assessment = self._parse_response(response.text)
            
            logger.info(
                "✅ Threat assessment completed",
                classification=assessment.classification.value,
                confidence=assessment.confidence,
                evidence_count=len(assessment.evidence),
                llm_efficiency=f"{self.blocks_processed}/{self.llm_calls_count} blocks per call"
            )
            
            return assessment
            
        except Exception as e:
            logger.error("Gemini analysis failed", error=str(e))
            return ThreatAssessment(
                classification=ThreatClassification.NATURAL,
                confidence=0.0,
                explanation=f"Analysis error: {str(e)}",
                evidence=[]
            )
    
    def quick_check(self, context: Dict[str, Any]) -> bool:
        """
        Quick heuristic check before LLM analysis
        
        CRITICAL: This is the gatekeeper for LLM calls.
        Only returns True if REAL anomalies are detected.
        
        Returns True if situation warrants LLM analysis.
        This saves API calls for clearly normal situations.
        
        LLM SHOULD BE CALLED:
        - Price deviation >5% (flash loan indicator)
        - Multiple oracle updates same block (manipulation)
        - Multiple large swaps same block (>10 WETH)
        - Price spike and recovery in <2 blocks (flash loan)
        - Liquidation during price drop (unfair liquidation)
        
        LLM SHOULD NOT BE CALLED:
        - Normal price movements
        - Single small swaps
        - Expected user activity
        - Every cycle/block
        """
        self.blocks_processed += 1
        
        anomalies = context.get("anomaly_indicators", {})
        current_block = context.get("current_state", {}).get("block_number", 0)
        
        # Generate event signature for deduplication
        activity = context.get("activity_metrics", {})
        recent_liquidations = context.get("recent_liquidations", [])
        
        # Track price to detect static/idle state
        oracle_price = context.get("current_state", {}).get("oracle_price_usd", 0)
        amm_price = context.get("current_state", {}).get("amm_spot_price_usd", 0)
        current_deviation = context.get("current_state", {}).get("price_deviation_pct", 0)
        
        # Create state signature to detect repeating scenarios
        state_sig = f"{oracle_price:.2f}_{amm_price:.10f}_{activity.get('recent_liquidations_count', 0)}_{activity.get('amm_swaps_this_block', 0)}"
        
        self.last_prices.append(state_sig)
        if len(self.last_prices) > 10:
            self.last_prices.pop(0)
        
        # Check if we're in a repeating static state (no new activity)
        if len(self.last_prices) >= 5:
            unique_states = len(set(self.last_prices))
            if unique_states <= 2:  # Only 1-2 unique states in last 5+ blocks
                # Static/repeating state detected - suppress LLM calls ALWAYS
                if self.static_state_warnings % 10 == 0:
                    logger.info("ℹ️  Static state detected (no new activity) - suppressing repeated LLM analysis", 
                               unique_states=unique_states,
                               deviation_pct=current_deviation)
                self.static_state_warnings += 1
                return False  # Always suppress on static state
        
        # EARLY EXIT: Skip LLM if no real activity (avoids false positives on empty testnet)
        has_recent_activity = (
            activity.get("recent_liquidations_count", 0) > 0 or
            activity.get("recent_large_swaps_count", 0) > 0 or
            activity.get("amm_swaps_this_block", 0) > 0 or
            activity.get("oracle_updates_this_block", 0) > 0
        )
        
        # If no activity, only flag if deviation is significant (>5%)
        # Lower threshold to detect attacks faster
        if not has_recent_activity:
            deviation = context.get("current_state", {}).get("price_deviation_pct", 0)
            if deviation < 5.0:
                logger.debug("No activity + minor deviation - skipping LLM", deviation=f"{deviation:.2f}%")
                return False
            elif deviation >= 30.0:
                # HIGH DEVIATION - Treat as ATTACK even without activity!
                logger.warning(
                    "🚨 HIGH price deviation detected - ATTACK LIKELY!",
                    deviation_pct=deviation
                )
                return True  # Force LLM analysis
            else:
                logger.warning(
                    "⚠️ Price deviation detected WITHOUT activity - monitoring",
                    deviation_pct=deviation
                )
        
        # Deduplicate: Don't re-analyze same events
        if recent_liquidations:
            for liq in recent_liquidations:
                event_key = f"liq_{liq.get('user', '')}_{liq.get('block', 0)}"
                if event_key in self.analyzed_events:
                    logger.debug("Skipping - liquidation already analyzed", event=event_key)
                    return False
                self.analyzed_events.add(event_key)
                # Keep cache size limited
                if len(self.analyzed_events) > 1000:
                    self.analyzed_events.clear()
        
        # STRICT THRESHOLDS - only flag real anomalies
        
        # 1. Significant price deviation (>50% indicates active attack)
        deviation = context.get("current_state", {}).get("price_deviation_pct", 0)
        if deviation > 50.0:
            logger.info("🚨 Anomaly detected: CRITICAL price deviation", deviation=f"{deviation:.2f}%")
            return True
        
        # 2. Multiple oracle updates in same block (manipulation)
        if anomalies.get("multiple_oracle_updates_same_block"):
            oracle_updates = activity.get("oracle_updates_this_block", 0)
            if oracle_updates > 1:
                logger.info("🚨 Anomaly detected: Multiple oracle updates", count=oracle_updates)
                return True
        
        # 3. Multiple swaps in same block (could be flash loan)
        swaps_count = activity.get("amm_swaps_this_block", 0)
        large_swaps_count = activity.get("recent_large_swaps_count", 0)
        if swaps_count > 3 and large_swaps_count > 0:
            logger.info("🚨 Anomaly detected: Multiple large swaps", 
                       swaps=swaps_count, 
                       large=large_swaps_count)
            return True
        
        # 4. Same-block price recovery pattern (flash loan signature)
        if anomalies.get("same_block_price_recovery_pattern"):
            logger.info("🚨 Anomaly detected: Same-block price recovery")
            return True
        
        # 5. Liquidation after price drop (potential unfair liquidation)
        if anomalies.get("liquidation_after_price_drop"):
            liquidations = activity.get("recent_liquidations_count", 0)
            if liquidations > 0:
                logger.info("🚨 Anomaly detected: Liquidation after price drop", count=liquidations)
                return True
        
        # 6. Extreme price change in recent blocks (>10%)
        recent_changes = context.get("recent_price_changes", [])
        for change in recent_changes:
            if abs(change.get("change_pct", 0)) > 10:
                logger.info("🚨 Anomaly detected: Extreme price movement", 
                           change=f"{change.get('change_pct', 0):.2f}%")
                return True
        
        # No anomalies - don't call LLM
        logger.debug(
            "✅ No anomalies - skipping LLM",
            block=current_block,
            deviation=f"{deviation:.2f}%",
            swaps=swaps_count
        )
        return False
