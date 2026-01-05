"""
AMEN Backend - FastAPI Application
REST API for security event logging and dashboard data
"""

import os
import asyncio
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine
from dotenv import load_dotenv
from web3 import Web3

from models import (
    Base, 
    SecurityEvent, 
    MarketSnapshot, 
    AgentAction,
    get_database_url,
    create_tables
)

# Load environment
load_dotenv("../.env")

# Initialize Web3 for blockchain queries
RPC_URL = os.getenv("SEPOLIA_RPC_URL", "https://eth-sepolia.g.alchemy.com/v2/DsAGO4co8iV4lmwiZYHW8")
w3 = Web3(Web3.HTTPProvider(RPC_URL))

# Load contract addresses
DEPLOYMENT_FILE = os.path.join(os.path.dirname(__file__), "..", "contracts", "deployments", "sepolia-deployment.json")
CONTRACT_ADDRESSES = {}
try:
    with open(DEPLOYMENT_FILE) as f:
        CONTRACT_ADDRESSES = json.load(f).get("contracts", {})
except:
    pass

# Simple ABI for paused() function
PAUSED_ABI = [{"inputs": [], "name": "paused", "outputs": [{"type": "bool"}], "stateMutability": "view", "type": "function"}]
LIQUIDATIONS_BLOCKED_ABI = [{"inputs": [], "name": "liquidationsBlocked", "outputs": [{"type": "bool"}], "stateMutability": "view", "type": "function"}]


def get_blockchain_state():
    """Query blockchain for current paused state"""
    amm_paused = False
    vault_paused = False
    liquidations_blocked = False
    
    try:
        if CONTRACT_ADDRESSES.get("AMM"):
            amm = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESSES["AMM"]), abi=PAUSED_ABI)
            amm_paused = amm.functions.paused().call()
    except Exception as e:
        pass
    
    try:
        if CONTRACT_ADDRESSES.get("LENDING_VAULT"):
            vault = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESSES["LENDING_VAULT"]), abi=PAUSED_ABI)
            vault_paused = vault.functions.paused().call()
    except:
        pass
    
    try:
        if CONTRACT_ADDRESSES.get("LENDING_VAULT"):
            vault = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESSES["LENDING_VAULT"]), abi=LIQUIDATIONS_BLOCKED_ABI)
            liquidations_blocked = vault.functions.liquidationsBlocked().call()
    except:
        pass
    
    return amm_paused, vault_paused, liquidations_blocked


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class SecurityEventCreate(BaseModel):
    """Input model for creating security events"""
    timestamp: str
    block_number: int
    event_type: str
    oracle_price: float
    amm_price: float
    price_deviation: float
    classification: Optional[str] = None
    confidence: Optional[float] = None
    explanation: Optional[str] = None
    evidence: Optional[List[str]] = None
    action: Optional[str] = None
    action_reason: Optional[str] = None
    execute_on_chain: Optional[bool] = None
    tx_hash: Optional[str] = None


class SecurityEventResponse(BaseModel):
    """Response model for security events"""
    id: int
    timestamp: str
    block_number: int
    event_type: str
    oracle_price: float
    amm_price: float
    price_deviation: float
    classification: Optional[str] = None
    confidence: Optional[float] = None
    explanation: Optional[str] = None
    evidence: Optional[List[str]] = None
    action: Optional[str] = None
    action_reason: Optional[str] = None
    execute_on_chain: Optional[bool] = None
    tx_hash: Optional[str] = None


class DashboardStats(BaseModel):
    """Dashboard statistics"""
    total_events: int
    threats_detected: int
    actions_taken: int
    current_oracle_price: float
    current_amm_price: float
    price_deviation: float
    amm_paused: bool
    vault_paused: bool
    liquidations_blocked: bool
    last_update: str


class PriceDataPoint(BaseModel):
    """Price data for charting"""
    timestamp: str
    oracle_price: float
    amm_price: float
    block_number: int


class ThreatTimelineEntry(BaseModel):
    """Threat timeline entry"""
    timestamp: str
    classification: str
    confidence: float
    action: Optional[str]
    tx_hash: Optional[str]
    explanation: Optional[str]


# =============================================================================
# DATABASE SETUP
# =============================================================================

# Create engine and session factory
engine = None
async_session_factory = None


async def init_db():
    """Initialize database"""
    global engine, async_session_factory
    
    # Create tables using sync engine first
    create_tables()
    
    # Create async engine
    db_url = get_database_url(use_async=True)
    engine = create_async_engine(db_url, echo=False)
    
    async_session_factory = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )


async def get_session() -> AsyncSession:
    """Get database session"""
    async with async_session_factory() as session:
        yield session


# =============================================================================
# WEBSOCKET MANAGER
# =============================================================================

class ConnectionManager:
    """WebSocket connection manager for real-time updates"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
    
    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass


manager = ConnectionManager()


# =============================================================================
# APP SETUP
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    await init_db()
    yield
    # Shutdown
    if engine:
        await engine.dispose()


app = FastAPI(
    title="AMEN Security Backend",
    description="API for DeFi security monitoring and event logging",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3001,http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# API ENDPOINTS
# =============================================================================

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "AMEN Security Backend",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.post("/api/events", response_model=SecurityEventResponse)
async def create_event(
    event: SecurityEventCreate,
    session: AsyncSession = Depends(get_session)
):
    """
    Create a new security event
    Called by the agent to log observations, assessments, and actions
    """
    # Parse timestamp
    try:
        timestamp = datetime.fromisoformat(event.timestamp.replace("Z", "+00:00"))
    except:
        timestamp = datetime.utcnow()
    
    # Create database record
    db_event = SecurityEvent(
        timestamp=timestamp,
        block_number=event.block_number,
        event_type=event.event_type,
        oracle_price=event.oracle_price,
        amm_price=event.amm_price,
        price_deviation=event.price_deviation,
        classification=event.classification,
        confidence=event.confidence,
        explanation=event.explanation,
        evidence=event.evidence,
        action=event.action,
        action_reason=event.action_reason,
        execute_on_chain=event.execute_on_chain,
        tx_hash=event.tx_hash
    )
    
    session.add(db_event)
    await session.commit()
    await session.refresh(db_event)
    
    # Broadcast to WebSocket clients
    await manager.broadcast({
        "type": "new_event",
        "data": db_event.to_dict()
    })
    
    return SecurityEventResponse(**db_event.to_dict())


@app.get("/api/events", response_model=List[SecurityEventResponse])
async def get_events(
    limit: int = 100,
    event_type: Optional[str] = None,
    classification: Optional[str] = None,
    session: AsyncSession = Depends(get_session)
):
    """Get security events with optional filtering"""
    query = select(SecurityEvent).order_by(desc(SecurityEvent.timestamp))
    
    if event_type:
        query = query.where(SecurityEvent.event_type == event_type)
    if classification:
        query = query.where(SecurityEvent.classification == classification)
    
    query = query.limit(limit)
    
    result = await session.execute(query)
    events = result.scalars().all()
    
    return [SecurityEventResponse(**e.to_dict()) for e in events]


@app.get("/api/events/threats", response_model=List[ThreatTimelineEntry])
async def get_threats(
    limit: int = 50,
    session: AsyncSession = Depends(get_session)
):
    """Get threat timeline (non-NATURAL classifications)"""
    query = (
        select(SecurityEvent)
        .where(SecurityEvent.classification.isnot(None))
        .where(SecurityEvent.classification != "NATURAL")
        .order_by(desc(SecurityEvent.timestamp))
        .limit(limit)
    )
    
    result = await session.execute(query)
    events = result.scalars().all()
    
    return [
        ThreatTimelineEntry(
            timestamp=e.timestamp.isoformat() if e.timestamp else "",
            classification=e.classification or "",
            confidence=e.confidence or 0,
            action=e.action,
            tx_hash=e.tx_hash,
            explanation=e.explanation
        )
        for e in events
    ]


@app.get("/api/events/actions", response_model=List[SecurityEventResponse])
async def get_actions(
    limit: int = 50,
    session: AsyncSession = Depends(get_session)
):
    """Get on-chain actions taken by agent"""
    query = (
        select(SecurityEvent)
        .where(SecurityEvent.event_type.in_(["ACTION", "PROACTIVE_DEFENSE", "AMM_PAUSED"]))
        .order_by(desc(SecurityEvent.timestamp))
        .limit(limit)
    )
    
    result = await session.execute(query)
    events = result.scalars().all()
    
    return [SecurityEventResponse(**e.to_dict()) for e in events]


@app.get("/api/stats", response_model=DashboardStats)
async def get_stats(session: AsyncSession = Depends(get_session)):
    """Get dashboard statistics"""
    # Total events
    total_result = await session.execute(select(func.count(SecurityEvent.id)))
    total_events = total_result.scalar() or 0
    
    # Threats detected
    threats_result = await session.execute(
        select(func.count(SecurityEvent.id))
        .where(SecurityEvent.classification.isnot(None))
        .where(SecurityEvent.classification != "NATURAL")
    )
    threats_detected = threats_result.scalar() or 0
    
    # Actions taken
    actions_result = await session.execute(
        select(func.count(SecurityEvent.id))
        .where(SecurityEvent.event_type == "ACTION")
    )
    actions_taken = actions_result.scalar() or 0
    
    # Latest observation for current state
    latest_result = await session.execute(
        select(SecurityEvent)
        .where(SecurityEvent.event_type == "OBSERVATION")
        .order_by(desc(SecurityEvent.timestamp))
        .limit(1)
    )
    latest = latest_result.scalar()
    
    # Get actual blockchain state
    amm_paused, vault_paused, liquidations_blocked = get_blockchain_state()
    
    if latest:
        return DashboardStats(
            total_events=total_events,
            threats_detected=threats_detected,
            actions_taken=actions_taken,
            current_oracle_price=latest.oracle_price,
            current_amm_price=latest.amm_price,
            price_deviation=latest.price_deviation,
            amm_paused=amm_paused,
            vault_paused=vault_paused,
            liquidations_blocked=liquidations_blocked,
            last_update=latest.timestamp.isoformat() if latest.timestamp else ""
        )
    
    return DashboardStats(
        total_events=total_events,
        threats_detected=threats_detected,
        actions_taken=actions_taken,
        current_oracle_price=0,
        current_amm_price=0,
        price_deviation=0,
        amm_paused=amm_paused,
        vault_paused=vault_paused,
        liquidations_blocked=liquidations_blocked,
        last_update=""
    )


@app.get("/api/prices", response_model=List[PriceDataPoint])
async def get_price_history(
    hours: int = 1,
    session: AsyncSession = Depends(get_session)
):
    """Get price history for charting"""
    since = datetime.utcnow() - timedelta(hours=hours)
    
    query = (
        select(SecurityEvent)
        .where(SecurityEvent.event_type == "OBSERVATION")
        .where(SecurityEvent.timestamp >= since)
        .order_by(SecurityEvent.timestamp)
    )
    
    result = await session.execute(query)
    events = result.scalars().all()
    
    return [
        PriceDataPoint(
            timestamp=e.timestamp.isoformat() if e.timestamp else "",
            oracle_price=e.oracle_price,
            amm_price=e.amm_price,
            block_number=e.block_number
        )
        for e in events
    ]


# =============================================================================
# ADMIN ENDPOINTS (Simulate Attack / Reset AMM)
# =============================================================================

@app.post("/api/admin/simulate-attack")
async def simulate_attack():
    """
    Simulate a flash loan attack on the AMM
    The AMEN agent should detect and block this
    """
    import subprocess
    
    try:
        contracts_dir = os.path.join(os.path.dirname(__file__), "..", "contracts")
        
        # Use the attack-with-defense script that shows blocking
        result = subprocess.run(
            "npx hardhat run scripts/attack-with-defense.js --network sepolia",
            cwd=contracts_dir,
            capture_output=True,
            timeout=120,
            shell=True,
            encoding='utf-8',
            errors='replace'  # Replace undecodable chars instead of crashing
        )
        
        # Handle None values
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        output = stdout + stderr
        
        # Check if attack was blocked
        if "BLOCKED" in output.upper() or "PAUSED" in output.upper() or "DEFENSE" in output.upper():
            return {
                "success": True,
                "blocked": True,
                "message": "🛡️ Attack was blocked by AMEN agent!",
                "output": output[-1000:] if len(output) > 1000 else output
            }
        elif "SUCCEEDED" in output.upper() or "CRASHED" in output.upper():
            return {
                "success": True,
                "blocked": False,
                "message": "💥 Attack succeeded - price was manipulated!",
                "output": output[-1000:] if len(output) > 1000 else output
            }
        else:
            return {
                "success": True,
                "blocked": False,
                "message": "Attack simulation completed",
                "output": output[-1000:] if len(output) > 1000 else output
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "blocked": False, "message": "Attack timed out (120s)"}
    except Exception as e:
        return {"success": False, "blocked": False, "message": str(e)}


@app.post("/api/admin/reset-amm")
async def reset_amm():
    """
    Reset the AMM to $2000 price (Fast version - rebalances existing AMM)
    """
    import subprocess
    
    try:
        contracts_dir = os.path.join(os.path.dirname(__file__), "..", "contracts")
        
        # Use fast reset script - much quicker than redeploying
        result = subprocess.run(
            "npx hardhat run scripts/fast-reset-amm.js --network sepolia",
            cwd=contracts_dir,
            capture_output=True,
            timeout=90,
            shell=True,
            encoding='utf-8',
            errors='replace'
        )
        
        # Handle None values
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        output = stdout + stderr
        
        if "Reset" in output or "2000" in output or result.returncode == 0:
            return {
                "success": True,
                "message": "✅ AMM reset to $2000!",
                "new_price": 2000.0,
                "output": output[-500:] if len(output) > 500 else output
            }
        else:
            return {
                "success": False,
                "message": f"Reset issue: {output[-200:]}",
                "output": output
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "Reset timed out (90s)"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/api/admin/restore-price")
async def restore_price():
    """
    AUTO-RESTORE: Agent calls this to restore AMM price after attack detection
    Executes counter-swap to neutralize the manipulation
    """
    import subprocess
    
    try:
        print("🔄 Agent requesting automatic price restoration...")
        contracts_dir = os.path.join(os.path.dirname(__file__), "..", "contracts")
        
        result = subprocess.run(
            "npx hardhat run scripts/agent-restore-price.js --network sepolia",
            cwd=contracts_dir,
            capture_output=True,
            timeout=180,  # 3 min timeout for blockchain txs
            shell=True,
            encoding='utf-8',
            errors='replace'
        )
        
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        output = stdout + stderr
        
        print(f"Restore output:\n{output}")
        
        success = "RESTORATION COMPLETE" in output or "already near" in output
        
        return {
            "success": success,
            "message": "✅ Price automatically restored!" if success else "⚠️ Restoration attempted",
            "output": output[-800:] if len(output) > 800 else output
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "⏱️ Restoration timed out"}
    except Exception as e:
        print(f"Restore error: {e}")
        return {"success": False, "message": str(e)}


@app.post("/api/admin/redeploy-amm")
async def redeploy_amm():
    """
    Alias for reset-amm - Redeploy AMM to $2000 price
    """
    return await reset_amm()


@app.post("/api/admin/unpause")
async def unpause_protocol():
    """
    Unpause all protocol components (AMM, Vault, Liquidations)
    Used to reset after attack blocking for new tests
    """
    import subprocess
    
    try:
        contracts_dir = os.path.join(os.path.dirname(__file__), "..", "contracts")
        
        result = subprocess.run(
            "npx hardhat run scripts/unpause-all.js --network sepolia",
            cwd=contracts_dir,
            capture_output=True,
            timeout=90,
            shell=True,
            encoding='utf-8',
            errors='replace'
        )
        
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        output = stdout + stderr
        
        if "NORMAL" in output or "unpaused" in output.lower():
            return {
                "success": True,
                "message": "✅ Protocol reset to normal operating state",
                "output": output[-500:] if len(output) > 500 else output
            }
        else:
            return {
                "success": True,
                "message": "Reset completed",
                "output": output[-500:] if len(output) > 500 else output
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "Unpause timed out (90s)"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# =============================================================================
# WEBSOCKET ENDPOINT
# =============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            # Echo back for ping/pong
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", "8080"))
    host = os.getenv("HOST", "0.0.0.0")
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True
    )
