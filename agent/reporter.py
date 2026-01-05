"""
AMEN - Reporter
Logs events and sends reports to backend
"""

import asyncio
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
import json
import httpx
import structlog

from config import AgentConfig
from observer import MarketSnapshot
from reasoner import ThreatAssessment
from decider import PolicyDecision


logger = structlog.get_logger()


@dataclass
class SecurityEvent:
    """
    Structured security event for logging and reporting
    """
    timestamp: str
    block_number: int
    event_type: str  # OBSERVATION, ASSESSMENT, DECISION, ACTION
    
    # Market data at time of event
    oracle_price: float
    amm_price: float
    price_deviation: float
    
    # Assessment data (if applicable)
    classification: Optional[str] = None
    confidence: Optional[float] = None
    explanation: Optional[str] = None
    evidence: Optional[List[str]] = None
    
    # Decision data (if applicable)
    action: Optional[str] = None
    action_reason: Optional[str] = None
    execute_on_chain: Optional[bool] = None
    
    # Execution data (if applicable)
    tx_hash: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


class Reporter:
    """
    Security event reporter
    
    Responsibilities:
    - Log events locally
    - Send events to backend API
    - Maintain event history
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        self.backend_url = config.backend_url
        self.event_history: List[SecurityEvent] = []
        
        # HTTP client for backend communication
        self.client = httpx.AsyncClient(
            base_url=self.backend_url,
            timeout=10.0
        )
        
        logger.info("Reporter initialized", backend_url=self.backend_url)
    
    async def report_observation(self, snapshot: MarketSnapshot) -> SecurityEvent:
        """Report a market observation"""
        event = SecurityEvent(
            timestamp=snapshot.timestamp.isoformat(),
            block_number=snapshot.block_number,
            event_type="OBSERVATION",
            oracle_price=snapshot.oracle_price,
            amm_price=snapshot.amm_spot_price,
            price_deviation=snapshot.price_deviation_pct
        )
        
        await self._log_and_send(event)
        return event
    
    async def report_assessment(
        self, 
        snapshot: MarketSnapshot, 
        assessment: ThreatAssessment
    ) -> SecurityEvent:
        """Report a threat assessment"""
        event = SecurityEvent(
            timestamp=datetime.now().isoformat(),
            block_number=snapshot.block_number,
            event_type="ASSESSMENT",
            oracle_price=snapshot.oracle_price,
            amm_price=snapshot.amm_spot_price,
            price_deviation=snapshot.price_deviation_pct,
            classification=assessment.classification.value,
            confidence=assessment.confidence,
            explanation=assessment.explanation,
            evidence=assessment.evidence
        )
        
        await self._log_and_send(event)
        return event
    
    async def report_decision(
        self,
        snapshot: MarketSnapshot,
        assessment: ThreatAssessment,
        decision: PolicyDecision
    ) -> SecurityEvent:
        """Report a policy decision"""
        event = SecurityEvent(
            timestamp=datetime.now().isoformat(),
            block_number=snapshot.block_number,
            event_type="DECISION",
            oracle_price=snapshot.oracle_price,
            amm_price=snapshot.amm_spot_price,
            price_deviation=snapshot.price_deviation_pct,
            classification=assessment.classification.value,
            confidence=assessment.confidence,
            explanation=assessment.explanation,
            evidence=assessment.evidence,
            action=decision.action.value,
            action_reason=decision.reason,
            execute_on_chain=decision.execute_on_chain
        )
        
        await self._log_and_send(event)
        return event
    
    async def report_action(
        self,
        snapshot: MarketSnapshot,
        decision: PolicyDecision,
        tx_hash: Optional[str]
    ) -> SecurityEvent:
        """Report an executed on-chain action"""
        event = SecurityEvent(
            timestamp=datetime.now().isoformat(),
            block_number=snapshot.block_number,
            event_type="ACTION",
            oracle_price=snapshot.oracle_price,
            amm_price=snapshot.amm_spot_price,
            price_deviation=snapshot.price_deviation_pct,
            classification=decision.threat_classification.value,
            confidence=decision.confidence,
            action=decision.action.value,
            action_reason=decision.reason,
            execute_on_chain=True,
            tx_hash=tx_hash
        )
        
        await self._log_and_send(event)
        return event
    
    async def report_amm_pause(
        self,
        snapshot: MarketSnapshot,
        assessment: ThreatAssessment,
        tx_hash: str
    ) -> SecurityEvent:
        """Report AMM emergency pause - ATTACK BLOCKED!"""
        event = SecurityEvent(
            timestamp=datetime.now().isoformat(),
            block_number=snapshot.block_number,
            event_type="AMM_PAUSED",
            oracle_price=snapshot.oracle_price,
            amm_price=snapshot.amm_spot_price,
            price_deviation=snapshot.price_deviation_pct,
            classification=assessment.classification.value,
            confidence=assessment.confidence,
            explanation=f"🛡️ ATTACK BLOCKED! AMM paused to prevent manipulation. {assessment.explanation}",
            evidence=assessment.evidence,
            action="PAUSE_AMM",
            action_reason="Emergency AMM pause - blocking price manipulation attack",
            execute_on_chain=True,
            tx_hash=tx_hash
        )
        
        logger.warning(
            "🚨🛡️ AMM PAUSED - ATTACK BLOCKED! 🛡️🚨",
            tx_hash=tx_hash,
            threat=assessment.classification.value,
            confidence=f"{assessment.confidence:.0%}"
        )
        
        await self._log_and_send(event)
        return event
    
    async def report_proactive_defense(
        self,
        snapshot: MarketSnapshot,
        deviation_pct: float,
        tx_hash: str
    ) -> SecurityEvent:
        """Report proactive defense activation - immediate AMM pause on large deviation"""
        event = SecurityEvent(
            timestamp=datetime.now().isoformat(),
            block_number=snapshot.block_number,
            event_type="PROACTIVE_DEFENSE",
            oracle_price=snapshot.oracle_price,
            amm_price=snapshot.amm_spot_price,
            price_deviation=snapshot.price_deviation_pct,
            classification="FLASH_LOAN_ATTACK",
            confidence=0.95,  # High confidence for large deviations
            explanation=f"🛡️ PROACTIVE DEFENSE! Detected {deviation_pct:.1f}% price deviation - immediate AMM pause triggered without waiting for LLM analysis.",
            evidence=[
                f"Price deviation: {deviation_pct:.1f}%",
                f"Oracle price: ${snapshot.oracle_price:.2f}",
                f"AMM price: ${snapshot.amm_spot_price:.2f}",
                "Large deviation indicates flash loan attack in progress"
            ],
            action="PROACTIVE_PAUSE_AMM",
            action_reason=f"Immediate defense - {deviation_pct:.1f}% deviation exceeds proactive threshold",
            execute_on_chain=True,
            tx_hash=tx_hash
        )
        
        logger.warning(
            "🚨🛡️ PROACTIVE DEFENSE ACTIVATED! 🛡️🚨",
            tx_hash=tx_hash,
            deviation=f"{deviation_pct:.1f}%",
            oracle_price=f"${snapshot.oracle_price:.2f}",
            amm_price=f"${snapshot.amm_spot_price:.2f}"
        )
        
        await self._log_and_send(event)
        return event
    
    async def _log_and_send(self, event: SecurityEvent) -> None:
        """Log event locally and send to backend"""
        # Store in history
        self.event_history.append(event)
        if len(self.event_history) > 1000:
            self.event_history.pop(0)
        
        # Log locally based on event type
        if event.event_type == "ACTION":
            logger.warning(
                "SECURITY ACTION EXECUTED",
                action=event.action,
                tx_hash=event.tx_hash,
                block=event.block_number
            )
        elif event.event_type == "DECISION" and event.execute_on_chain:
            logger.warning(
                "SECURITY DECISION",
                action=event.action,
                confidence=event.confidence,
                reason=event.action_reason[:100] if event.action_reason else None
            )
        elif event.event_type == "ASSESSMENT" and event.classification != "NATURAL":
            logger.info(
                "THREAT ASSESSMENT",
                classification=event.classification,
                confidence=event.confidence
            )
        else:
            logger.debug(
                "Security event",
                event_type=event.event_type,
                block=event.block_number
            )
        
        # Send to backend
        await self._send_to_backend(event)
    
    async def _send_to_backend(self, event: SecurityEvent) -> None:
        """Send event to backend API"""
        try:
            response = await self.client.post(
                "/api/events",
                json=event.to_dict()
            )
            
            if response.status_code != 200:
                logger.warning(
                    "Backend API returned non-200",
                    status=response.status_code
                )
                
        except httpx.ConnectError:
            logger.debug("Backend not available, skipping send")
        except Exception as e:
            logger.warning("Failed to send event to backend", error=str(e))
    
    async def get_recent_events(self, count: int = 50) -> List[Dict[str, Any]]:
        """Get recent events from history"""
        return [e.to_dict() for e in self.event_history[-count:]]
    
    async def close(self) -> None:
        """Close HTTP client"""
        await self.client.aclose()
