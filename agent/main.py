"""
AMEN - Agentic Manipulation Engine Neutralizer
Main Agent Loop

This is the core agent that implements the OBSERVE → REASON → DECIDE → ACT → REPORT loop
for protecting DeFi protocols from manipulation attacks.

Architecture:
    Observer  → Collects on-chain data
    Reasoner  → LLM-powered threat analysis
    Decider   → Policy engine for decisions
    Actor     → Executes on-chain actions
    Reporter  → Logs and reports events

Usage:
    python main.py

Configuration:
    All config via environment variables (see .env.example)
"""

import asyncio
import signal
import sys
import os
from datetime import datetime
from typing import Optional

import structlog
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.live import Live
from rich.layout import Layout

# FastAPI for Cloud Run health checks
from fastapi import FastAPI
from contextlib import asynccontextmanager
import uvicorn

from config import load_config, AgentConfig
from observer import Observer, MarketSnapshot
from reasoner import Reasoner, ThreatAssessment, ThreatClassification
from decider import PolicyEngine, PolicyDecision, ActionType
from actor import Actor
from reporter import Reporter


# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()
console = Console()


class AMENAgent:
    """
    AMEN Security Agent
    
    Autonomous agent that monitors DeFi protocols for manipulation
    and takes protective actions when threats are detected.
    
    Loop:
        1. OBSERVE: Collect market data from blockchain
        2. REASON: Analyze data with LLM for threat detection
        3. DECIDE: Apply policy rules to determine action
        4. ACT: Execute protective on-chain transactions
        5. REPORT: Log events to backend
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        self.running = False
        
        # Initialize components
        logger.info("Initializing AMEN Agent components...")
        
        self.observer = Observer(config)
        self.reasoner = Reasoner(config)
        self.decider = PolicyEngine(config)
        self.actor = Actor(config)
        self.reporter = Reporter(config)
        
        # Statistics
        self.cycles = 0
        self.threats_detected = 0
        self.actions_taken = 0
        self.last_snapshot: Optional[MarketSnapshot] = None
        self.last_assessment: Optional[ThreatAssessment] = None
        self.last_decision: Optional[PolicyDecision] = None
        
        logger.info("AMEN Agent initialized successfully")
    
    async def run_cycle(self) -> None:
        """
        Run one complete OBSERVE → REASON → DECIDE → ACT → REPORT cycle
        With PROACTIVE DEFENSE for immediate threat response
        """
        self.cycles += 1
        
        try:
            # ==================================================================
            # OBSERVE: Collect on-chain data
            # ==================================================================
            snapshot = self.observer.observe()
            self.last_snapshot = snapshot
            
            # Show observation in console
            console.print(f"\n[cyan]═══ Cycle {self.cycles} ═══[/cyan]")
            console.print(f"  📊 Block: {snapshot.block_number}")
            console.print(f"  💰 Oracle Price: ${snapshot.oracle_price:.2f}")
            console.print(f"  📈 AMM Price: ${snapshot.amm_spot_price:.2f}")
            console.print(f"  📉 Deviation: {snapshot.price_deviation_pct:.2%}")
            
            # ==================================================================
            # PROACTIVE DEFENSE: Immediate action on large deviations
            # This runs BEFORE LLM analysis for speed
            # ==================================================================
            proactive_threshold = getattr(self.config, 'proactive_pause_deviation', 0.08) * 100
            
            if (snapshot.price_deviation_pct > proactive_threshold and 
                not snapshot.amm_paused and
                not snapshot.vault_paused):
                
                console.print(f"  [bold red]🚨🚨🚨 CRITICAL DEVIATION DETECTED! 🚨🚨🚨[/bold red]")
                console.print(f"  [bold red]   Deviation: {snapshot.price_deviation_pct:.1f}% > {proactive_threshold:.1f}% threshold[/bold red]")
                console.print(f"  [bold red]   ACTIVATING PROACTIVE DEFENSE![/bold red]")
                
                # Immediately pause AMM - no LLM needed for obvious attacks
                try:
                    amm_tx = await self.actor.pause_amm()
                    console.print(f"  [bold green]🛡️ AMM PAUSED PROACTIVELY! TX: {amm_tx}[/bold green]")
                    self.actions_taken += 1
                    
                    # Also block liquidations
                    try:
                        liq_tx = await self.actor._block_liquidations()
                        console.print(f"  [bold green]🛡️ LIQUIDATIONS BLOCKED! TX: {liq_tx}[/bold green]")
                        self.actions_taken += 1
                    except Exception as e:
                        if "already blocked" in str(e).lower():
                            console.print(f"  [yellow]ℹ️ Liquidations already blocked[/yellow]")
                        else:
                            console.print(f"  [red]⚠️ Could not block liquidations: {e}[/red]")
                    
                    # Report the proactive action
                    await self.reporter.report_proactive_defense(snapshot, snapshot.price_deviation_pct, amm_tx)
                    
                    # ============================================================
                    # AUTO-RESTORE: Wait 5 seconds then restore price
                    # This shows the attack in the UI before counter-attacking
                    # ============================================================
                    console.print(f"  [bold cyan]⏳ Waiting 5 seconds to show attack in UI...[/bold cyan]")
                    await asyncio.sleep(5)
                    
                    console.print(f"  [bold cyan]🔄 INITIATING AUTOMATIC PRICE RESTORATION...[/bold cyan]")
                    try:
                        import aiohttp
                        async with aiohttp.ClientSession() as session:
                            async with session.post(
                                f"{self.config.backend_url}/api/admin/restore-price",
                                timeout=aiohttp.ClientTimeout(total=180)
                            ) as resp:
                                result = await resp.json()
                                if result.get("success"):
                                    console.print(f"  [bold green]✅ PRICE AUTOMATICALLY RESTORED![/bold green]")
                                    self.actions_taken += 1
                                else:
                                    console.print(f"  [yellow]⚠️ Restore: {result.get('message')}[/yellow]")
                    except Exception as e:
                        console.print(f"  [yellow]⚠️ Could not auto-restore: {e}[/yellow]")
                    
                    console.print(f"  [bold green]🛡️ DEFENSE COMPLETE - Attack Neutralized![/bold green]")
                    
                except Exception as e:
                    if "Already paused" in str(e):
                        console.print(f"  [yellow]ℹ️ AMM already paused - protection active[/yellow]")
                    else:
                        console.print(f"  [red]❌ Failed to pause AMM: {e}[/red]")
                
                # Skip LLM analysis since we already took action
                self.threats_detected += 1
                return
            
            # Report observation
            await self.reporter.report_observation(snapshot)
            
            # ==================================================================
            # REASON: Analyze for threats (LLM COST SAFETY)
            # ==================================================================
            context = self.observer.get_analysis_context(snapshot)
            
            # Quick deterministic check - NO LLM call
            if self.reasoner.quick_check(context):
                # Anomaly detected - NOW call LLM for deep analysis
                console.print(f"  [yellow]⚠️  ANOMALY DETECTED - Invoking Gemini LLM...[/yellow]")
                assessment = await self.reasoner.analyze(context)
                console.print(f"  [red]🚨 LLM Assessment: {assessment.classification.value}[/red]")
                console.print(f"  [red]   Confidence: {assessment.confidence:.0%}[/red]")
            else:
                # No anomalies - skip LLM entirely (save cost/rate-limit)
                assessment = ThreatAssessment(
                    classification=ThreatClassification.NATURAL,
                    confidence=0.95,
                    explanation="No anomalies detected in deterministic checks",
                    evidence=[]
                )
                console.print(f"  [green]✅ Status: NORMAL[/green]")
            
            self.last_assessment = assessment
            
            # Report if non-trivial assessment
            if assessment.classification != ThreatClassification.NATURAL:
                await self.reporter.report_assessment(snapshot, assessment)
                self.threats_detected += 1
            
            # ==================================================================
            # DECIDE: Apply policy rules
            # ==================================================================
            decision = self.decider.decide(assessment)
            
            # Check for redundant actions
            decision = self.decider.should_override_decision(
                decision,
                vault_paused=snapshot.vault_paused,
                liquidations_blocked=snapshot.liquidations_blocked
            )
            
            self.last_decision = decision
            
            # Report decision if action needed
            if decision.action != ActionType.NONE:
                await self.reporter.report_decision(snapshot, assessment, decision)
                console.print(f"  [yellow]⚡ Decision: {decision.action.value}[/yellow]")
            
            # ==================================================================
            # ACT: Execute on-chain action
            # ==================================================================
            if decision.execute_on_chain:
                console.print(f"  [bold red]🛡️ EXECUTING ON-CHAIN ACTION: {decision.action.value}[/bold red]")
                tx_hash = await self.actor.execute(decision)
                self.actions_taken += 1
                
                # Report action
                await self.reporter.report_action(snapshot, decision, tx_hash)
                
                console.print(f"  [bold green]✅ TX: {tx_hash}[/bold green]")
            
            # ==================================================================
            # PROACTIVE AMM PROTECTION: Pause AMM on high-confidence attacks
            # ==================================================================
            if (assessment.classification in [ThreatClassification.FLASH_LOAN_ATTACK, ThreatClassification.ORACLE_MANIPULATION] 
                and assessment.confidence > 0.7
                and not snapshot.amm_paused):
                
                console.print(f"  [bold magenta]🚨🚨🚨 HIGH THREAT DETECTED - PAUSING AMM 🚨🚨🚨[/bold magenta]")
                console.print(f"  [bold magenta]   Threat: {assessment.classification.value}[/bold magenta]")
                console.print(f"  [bold magenta]   Confidence: {assessment.confidence:.0%}[/bold magenta]")
                console.print(f"  [bold magenta]   Reason: {assessment.explanation[:100]}...[/bold magenta]")
                
                try:
                    amm_tx = await self.actor.pause_amm()
                    console.print(f"  [bold green]🛡️ AMM PAUSED - ATTACK BLOCKED! TX: {amm_tx}[/bold green]")
                    
                    # Report AMM pause action
                    await self.reporter.report_amm_pause(snapshot, assessment, amm_tx)
                    self.actions_taken += 1
                except Exception as e:
                    console.print(f"  [red]❌ Failed to pause AMM: {e}[/red]")
            
        except Exception as e:
            console.print(f"  [red]❌ Error in cycle {self.cycles}: {e}[/red]")
            import traceback
            traceback.print_exc()
    
    async def run(self) -> None:
        """
        Main agent loop
        Runs continuously until stopped
        """
        self.running = True
        
        console.print(Panel.fit(
            "[bold green]AMEN Security Agent Started[/bold green]\n"
            f"Chain ID: {self.config.chain_id}\n"
            f"Poll Interval: {self.config.poll_interval}s\n"
            f"Pause Threshold: {self.config.pause_confidence_threshold:.0%}",
            title="🛡️ AMEN"
        ))
        
        while self.running:
            try:
                await self.run_cycle()
                await asyncio.sleep(self.config.poll_interval)
                
            except asyncio.CancelledError:
                logger.info("Agent loop cancelled")
                break
            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received")
                break
            except Exception as e:
                logger.error("Unexpected error in main loop", error=str(e))
                await asyncio.sleep(5)  # Back off on errors
        
        await self.shutdown()
    
    async def shutdown(self) -> None:
        """Clean shutdown"""
        logger.info("Shutting down AMEN Agent...")
        self.running = False
        await self.reporter.close()
        
        # Calculate LLM efficiency
        llm_efficiency = (
            f"{self.reasoner.blocks_processed / max(1, self.reasoner.llm_calls_count):.1f}"
            if self.reasoner.llm_calls_count > 0 
            else "N/A"
        )
        
        console.print(Panel.fit(
            f"[bold yellow]AMEN Agent Stopped[/bold yellow]\n"
            f"Cycles: {self.cycles}\n"
            f"Threats Detected: {self.threats_detected}\n"
            f"Actions Taken: {self.actions_taken}\n\n"
            f"[dim]💰 LLM Cost Efficiency:[/dim]\n"
            f"LLM Calls: {self.reasoner.llm_calls_count}\n"
            f"Blocks Processed: {self.reasoner.blocks_processed}\n"
            f"Efficiency: {llm_efficiency} blocks/call",
            title="📊 Session Summary"
        ))
    
    def get_status(self) -> dict:
        """Get current agent status"""
        return {
            "running": self.running,
            "cycles": self.cycles,
            "threats_detected": self.threats_detected,
            "actions_taken": self.actions_taken,
            "last_snapshot": self.last_snapshot.timestamp.isoformat() if self.last_snapshot else None,
            "last_classification": self.last_assessment.classification.value if self.last_assessment else None,
            "last_decision": self.last_decision.action.value if self.last_decision else None
        }


# Global agent instance for health check endpoint
_agent: Optional[AMENAgent] = None
_agent_error: Optional[str] = None
_agent_task: Optional[asyncio.Task] = None


async def start_agent_background():
    """Start agent in background - doesn't block HTTP server startup"""
    global _agent, _agent_error
    
    try:
        logger.info("Loading configuration...")
        config = load_config()
        
        logger.info("Initializing agent...")
        _agent = AMENAgent(config)
        
        logger.info("Starting agent loop...")
        await _agent.run()
    except Exception as e:
        _agent_error = str(e)
        logger.error("Agent initialization failed", error=str(e), exc_info=True)


# FastAPI app for Cloud Run health checks
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan handler - starts agent in background, doesn't block HTTP startup"""
    global _agent_task
    
    console.print("""
    [bold blue]
     █████╗ ███╗   ███╗███████╗███╗   ██╗
    ██╔══██╗████╗ ████║██╔════╝████╗  ██║
    ███████║██╔████╔██║█████╗  ██╔██╗ ██║
    ██╔══██║██║╚██╔╝██║██╔══╝  ██║╚██╗██║
    ██║  ██║██║ ╚═╝ ██║███████╗██║ ╚████║
    ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝
    [/bold blue]
    [dim]Agentic Manipulation Engine Neutralizer[/dim]
    [dim]DeFi Security System v1.0 (Cloud Run)[/dim]
    """)
    
    # Start agent loop in background task (doesn't block HTTP server startup)
    _agent_task = asyncio.create_task(start_agent_background())
    logger.info("Agent initialization started in background")
    
    yield
    
    # Shutdown
    logger.info("Shutting down agent...")
    if _agent:
        _agent.running = False
    if _agent_task:
        _agent_task.cancel()
        try:
            await _agent_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="AMEN Agent", lifespan=lifespan)


@app.get("/")
async def health():
    """Health check endpoint for Cloud Run"""
    # Always return healthy so Cloud Run doesn't kill us
    return {"status": "healthy", "service": "amen-agent"}


@app.get("/health")
async def health_detailed():
    """Detailed health check"""
    if _agent_error:
        return {"status": "error", "error": _agent_error}
    if _agent:
        return {
            "status": "healthy",
            "agent": _agent.get_status()
        }
    return {"status": "starting"}


@app.get("/status")
async def agent_status():
    """Get agent status"""
    if _agent:
        return _agent.get_status()
    return {"status": "not_initialized"}


async def main():
    """Main entry point - runs both HTTP server and agent loop"""
    
    # Set UTF-8 encoding for console
    if sys.platform == "win32":
        os.environ["PYTHONIOENCODING"] = "utf-8"
        try:
            os.system("chcp 65001 > nul 2>&1")
        except:
            pass
    
    # Get port from environment (Cloud Run sets PORT)
    port = int(os.environ.get("PORT", 8080))
    
    # Check if running in Cloud Run (has PORT env var set by platform)
    is_cloud_run = "K_SERVICE" in os.environ or "PORT" in os.environ
    
    if is_cloud_run:
        # Cloud Run mode: Run HTTP server with agent in background
        logger.info(f"Starting AMEN Agent in Cloud Run mode on port {port}")
        config = uvicorn.Config(
            app=app,
            host="0.0.0.0",
            port=port,
            log_level="info"
        )
        server = uvicorn.Server(config)
        await server.serve()
    else:
        # Local mode: Run agent directly without HTTP server
        console.print("""
    [bold blue]
     █████╗ ███╗   ███╗███████╗███╗   ██╗
    ██╔══██╗████╗ ████║██╔════╝████╗  ██║
    ███████║██╔████╔██║█████╗  ██╔██╗ ██║
    ██╔══██║██║╚██╔╝██║██╔══╝  ██║╚██╗██║
    ██║  ██║██║ ╚═╝ ██║███████╗██║ ╚████║
    ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝
    [/bold blue]
    [dim]Agentic Manipulation Engine Neutralizer[/dim]
    [dim]DeFi Security System v1.0[/dim]
        """)
        
        try:
            config = load_config()
            agent = AMENAgent(config)
            
            def signal_handler(signum, frame):
                if signum == signal.SIGINT:
                    logger.info("Received shutdown signal")
                    agent.running = False
            
            signal.signal(signal.SIGINT, signal_handler)
            if hasattr(signal, 'SIGTERM'):
                signal.signal(signal.SIGTERM, signal_handler)
            
            await agent.run()
            
        except Exception as e:
            logger.error("Failed to start agent", error=str(e), exc_info=True)
            console.print(f"[red]Error: {e}[/red]")
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
