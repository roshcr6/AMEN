"""
AMEN - Policy Engine (Decider)
Applies security policies based on threat assessments
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, List
import structlog

from config import AgentConfig
from reasoner import ThreatAssessment, ThreatClassification


logger = structlog.get_logger()


class ActionType(Enum):
    """Types of protective actions the agent can take"""
    NONE = "NONE"
    MONITOR = "MONITOR"  # Enhanced monitoring, no on-chain action
    BLOCK_LIQUIDATIONS = "BLOCK_LIQUIDATIONS"  # Block liquidations only
    PAUSE_PROTOCOL = "PAUSE_PROTOCOL"  # Full protocol pause
    FLAG_ORACLE = "FLAG_ORACLE"  # Flag oracle manipulation


@dataclass
class PolicyDecision:
    """
    Decision output from policy engine
    
    Contains:
    - The action to take
    - Reason for the decision
    - Whether to execute on-chain
    """
    action: ActionType
    reason: str
    execute_on_chain: bool
    confidence: float
    threat_classification: ThreatClassification
    evidence: List[str]
    
    def to_dict(self):
        return {
            "action": self.action.value,
            "reason": self.reason,
            "execute_on_chain": self.execute_on_chain,
            "confidence": self.confidence,
            "threat_classification": self.threat_classification.value,
            "evidence": self.evidence
        }


class PolicyEngine:
    """
    Security policy decision engine
    
    HARD-CODED RULES:
    1. FLASH_LOAN_ATTACK + confidence >= 0.75 → PAUSE_PROTOCOL
    2. ORACLE_MANIPULATION + confidence >= 0.60 → BLOCK_LIQUIDATIONS
    3. Any threat + confidence >= 0.50 → Enhanced MONITOR
    4. NATURAL or low confidence → NONE
    
    These thresholds are configurable but have sensible defaults.
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        
        # Policy thresholds
        self.pause_threshold = config.pause_confidence_threshold  # 0.75
        self.block_liquidation_threshold = config.block_liquidation_threshold  # 0.60
        self.monitor_threshold = 0.50
        
        logger.info(
            "Policy engine initialized",
            pause_threshold=self.pause_threshold,
            block_threshold=self.block_liquidation_threshold
        )
    
    def decide(self, assessment: ThreatAssessment) -> PolicyDecision:
        """
        Apply security policies to threat assessment
        
        Args:
            assessment: ThreatAssessment from Reasoner
            
        Returns:
            PolicyDecision with recommended action
        """
        classification = assessment.classification
        confidence = assessment.confidence
        
        logger.debug(
            "Applying policy rules",
            classification=classification.value,
            confidence=confidence
        )
        
        # =====================================================================
        # RULE 1: High-confidence flash loan attack → Full pause
        # =====================================================================
        if (classification == ThreatClassification.FLASH_LOAN_ATTACK and 
            confidence >= self.pause_threshold):
            
            logger.warning(
                "🚨 FLASH LOAN ATTACK DETECTED - PAUSING PROTOCOL",
                confidence=confidence,
                threshold=self.pause_threshold
            )
            
            return PolicyDecision(
                action=ActionType.PAUSE_PROTOCOL,
                reason=f"Flash loan attack detected with {confidence:.0%} confidence. "
                       f"Threshold: {self.pause_threshold:.0%}. "
                       f"Pausing protocol to prevent exploitation.",
                execute_on_chain=True,
                confidence=confidence,
                threat_classification=classification,
                evidence=assessment.evidence
            )
        
        # =====================================================================
        # RULE 2: Oracle manipulation → Block liquidations
        # =====================================================================
        if (classification == ThreatClassification.ORACLE_MANIPULATION and 
            confidence >= self.block_liquidation_threshold):
            
            logger.warning(
                "⚠️ ORACLE MANIPULATION DETECTED - BLOCKING LIQUIDATIONS",
                confidence=confidence,
                threshold=self.block_liquidation_threshold
            )
            
            return PolicyDecision(
                action=ActionType.BLOCK_LIQUIDATIONS,
                reason=f"Oracle manipulation detected with {confidence:.0%} confidence. "
                       f"Threshold: {self.block_liquidation_threshold:.0%}. "
                       f"Blocking liquidations to protect users.",
                execute_on_chain=True,
                confidence=confidence,
                threat_classification=classification,
                evidence=assessment.evidence
            )
        
        # =====================================================================
        # RULE 3: Medium-confidence flash loan → Block liquidations (conservative)
        # =====================================================================
        if (classification == ThreatClassification.FLASH_LOAN_ATTACK and 
            confidence >= self.block_liquidation_threshold):
            
            logger.warning(
                "⚠️ POTENTIAL FLASH LOAN ATTACK - BLOCKING LIQUIDATIONS",
                confidence=confidence
            )
            
            return PolicyDecision(
                action=ActionType.BLOCK_LIQUIDATIONS,
                reason=f"Potential flash loan attack with {confidence:.0%} confidence. "
                       f"Below pause threshold but blocking liquidations as precaution.",
                execute_on_chain=True,
                confidence=confidence,
                threat_classification=classification,
                evidence=assessment.evidence
            )
        
        # =====================================================================
        # RULE 4: Low-medium confidence threats → Enhanced monitoring
        # =====================================================================
        if (classification != ThreatClassification.NATURAL and 
            confidence >= self.monitor_threshold):
            
            logger.info(
                "📡 SUSPICIOUS ACTIVITY - ENHANCED MONITORING",
                classification=classification.value,
                confidence=confidence
            )
            
            return PolicyDecision(
                action=ActionType.MONITOR,
                reason=f"Suspicious activity ({classification.value}) with "
                       f"{confidence:.0%} confidence. Enhanced monitoring active.",
                execute_on_chain=False,  # No on-chain action yet
                confidence=confidence,
                threat_classification=classification,
                evidence=assessment.evidence
            )
        
        # =====================================================================
        # RULE 5: Oracle manipulation below threshold → Flag only
        # =====================================================================
        if classification == ThreatClassification.ORACLE_MANIPULATION:
            
            logger.info(
                "🔮 LOW-CONFIDENCE ORACLE ANOMALY",
                confidence=confidence
            )
            
            return PolicyDecision(
                action=ActionType.FLAG_ORACLE,
                reason=f"Oracle anomaly detected with {confidence:.0%} confidence. "
                       f"Below action threshold. Flagging for review.",
                execute_on_chain=False,
                confidence=confidence,
                threat_classification=classification,
                evidence=assessment.evidence
            )
        
        # =====================================================================
        # DEFAULT: Natural market activity or very low confidence
        # =====================================================================
        logger.debug(
            "Market activity normal",
            classification=classification.value,
            confidence=confidence
        )
        
        return PolicyDecision(
            action=ActionType.NONE,
            reason="Market activity within normal parameters.",
            execute_on_chain=False,
            confidence=confidence,
            threat_classification=classification,
            evidence=assessment.evidence
        )
    
    def should_override_decision(
        self, 
        decision: PolicyDecision,
        vault_paused: bool,
        liquidations_blocked: bool
    ) -> PolicyDecision:
        """
        Check if decision should be modified based on current state
        
        Prevents redundant actions (e.g., pausing already paused protocol)
        """
        # Don't pause if already paused
        if decision.action == ActionType.PAUSE_PROTOCOL and vault_paused:
            logger.info("Protocol already paused, skipping pause action")
            return PolicyDecision(
                action=ActionType.MONITOR,
                reason="Protocol already paused. Continuing monitoring.",
                execute_on_chain=False,
                confidence=decision.confidence,
                threat_classification=decision.threat_classification,
                evidence=decision.evidence
            )
        
        # Don't block liquidations if already blocked
        if decision.action == ActionType.BLOCK_LIQUIDATIONS and liquidations_blocked:
            logger.info("Liquidations already blocked, skipping block action")
            return PolicyDecision(
                action=ActionType.MONITOR,
                reason="Liquidations already blocked. Continuing monitoring.",
                execute_on_chain=False,
                confidence=decision.confidence,
                threat_classification=decision.threat_classification,
                evidence=decision.evidence
            )
        
        return decision
