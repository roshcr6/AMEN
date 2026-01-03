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

# Load contract addresses from environment or use defaults (Sepolia deployment)
CONTRACT_ADDRESSES = {
    "AMM": os.getenv("AMM_POOL_ADDRESS", "0x0Db2401DA9810F7f1023D8df8D52328E3A0f92Cd"),
    "LENDING_VAULT": os.getenv("LENDING_VAULT_ADDRESS", "0x09aEaE5751AFbc19A20f75eFd63B7431c094224c"),
    "ORACLE": os.getenv("ORACLE_ADDRESS", "0x0b939bbab85d69A27df77b45c1e5b7E8B5FB3D3f"),
    "WETH": os.getenv("WETH_ADDRESS", "0x7E8c42a6F66c2225015FDFf0814D7c1BaCc4A9d2"),
    "USDC": os.getenv("USDC_ADDRESS", "0xd333C2bfD3780Cb9eaf1a21B3EA856cBbf8479E1"),
}

# Try to load from deployment file (for local dev), otherwise use env vars
DEPLOYMENT_FILE = os.path.join(os.path.dirname(__file__), "..", "contracts", "deployments", "sepolia-deployment.json")
try:
    with open(DEPLOYMENT_FILE) as f:
        file_addresses = json.load(f).get("contracts", {})
        CONTRACT_ADDRESSES.update({k: v for k, v in file_addresses.items() if v})
except:
    pass  # Use environment variables or defaults

# Agent private key for transactions
AGENT_PRIVATE_KEY = os.getenv("AGENT_PRIVATE_KEY", "51a987387d54ac66224c321a06bcc389cfeb6627c13badda66d32008ac42c244")

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

# CORS configuration - allow all origins for Cloud Run deployment
# In production, you would restrict this to specific domains
cors_origins_env = os.getenv("CORS_ORIGINS", "")
if cors_origins_env:
    cors_origins = cors_origins_env.split(",")
else:
    # Default: allow localhost and Cloud Run frontend
    cors_origins = [
        "http://localhost:3001",
        "http://localhost:5173",
        "https://amen-frontend-93939916612.us-central1.run.app",
    ]

# For Cloud Run, allow all origins (simpler for demo)
allow_all_origins = os.getenv("ALLOW_ALL_ORIGINS", "true").lower() == "true"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# Add no-cache middleware to prevent stale data
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)


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
# ADMIN ENDPOINTS (Simulate Attack / Reset AMM) - Pure Web3 Implementation
# =============================================================================

# ABIs for contract interactions
AMM_ABI = [
    {"inputs": [], "name": "paused", "outputs": [{"type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getSpotPrice", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getReserves", "outputs": [{"name": "wethReserve", "type": "uint256"}, {"name": "usdcReserve", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "tokenIn", "type": "address"}, {"name": "amountIn", "type": "uint256"}, {"name": "minAmountOut", "type": "uint256"}], "name": "swap", "outputs": [{"type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "unpause", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

ERC20_ABI = [
    {"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "mint", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

VAULT_ABI = [
    {"inputs": [], "name": "paused", "outputs": [{"type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "liquidationsBlocked", "outputs": [{"type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "unpause", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "unblockLiquidations", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]


def get_agent_account():
    """Get the agent account for signing transactions"""
    from eth_account import Account
    return Account.from_key(AGENT_PRIVATE_KEY)


@app.post("/api/admin/simulate-attack")
async def simulate_attack():
    """
    Simulate a flash loan attack on the AMM using Web3.py
    Performs a large swap to manipulate the price
    """
    try:
        amm_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["AMM"])
        weth_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["WETH"])
        
        amm = w3.eth.contract(address=amm_address, abi=AMM_ABI)
        weth = w3.eth.contract(address=weth_address, abi=ERC20_ABI)
        
        # Check if AMM is paused first
        if amm.functions.paused().call():
            # Record that attack was blocked because AMM was already paused
            async with async_session_factory() as session:
                blocked_event = SecurityEvent(
                    timestamp=datetime.utcnow(),
                    block_number=w3.eth.block_number,
                    event_type="AMM_PAUSED",
                    oracle_price=2000.0,
                    amm_price=2000.0,
                    price_deviation=0,
                    classification="FLASH_LOAN_ATTACK",
                    confidence=0.95,
                    explanation="🛡️ ATTACK BLOCKED! AMM was already paused by AMEN agent - attack attempt rejected.",
                    evidence=["Attack attempt detected", "AMM already paused", "Swap would have been rejected"],
                    action="PAUSE_AMM",
                    action_reason="Proactive defense - AMM paused before attack",
                    execute_on_chain=True,
                    tx_hash="blocked-amm-paused"
                )
                session.add(blocked_event)
                await session.commit()
            
            return {
                "success": True,
                "blocked": True,
                "message": "🛡️ Attack blocked - AMM is already paused by AMEN agent!"
            }
        
        # Get current price
        price_before = amm.functions.getSpotPrice().call() / 1e8
        
        # Attack parameters: Large WETH swap to crash price
        attack_amount = Web3.to_wei(5, 'ether')  # 5 WETH to crash price
        
        account = get_agent_account()
        nonce = w3.eth.get_transaction_count(account.address)
        
        # First mint WETH for the attack (we have mint permission)
        mint_tx = weth.functions.mint(account.address, attack_amount).build_transaction({
            'from': account.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
            'chainId': 11155111
        })
        signed_mint = account.sign_transaction(mint_tx)
        mint_hash = w3.eth.send_raw_transaction(signed_mint.raw_transaction)
        w3.eth.wait_for_transaction_receipt(mint_hash, timeout=60)
        
        # Approve AMM to spend WETH
        nonce += 1
        approve_tx = weth.functions.approve(amm_address, attack_amount).build_transaction({
            'from': account.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
            'chainId': 11155111
        })
        signed_approve = account.sign_transaction(approve_tx)
        approve_hash = w3.eth.send_raw_transaction(signed_approve.raw_transaction)
        w3.eth.wait_for_transaction_receipt(approve_hash, timeout=60)
        
        # Execute the attack swap (WETH → USDC to crash WETH price)
        nonce += 1
        try:
            swap_tx = amm.functions.swap(weth_address, attack_amount, 0).build_transaction({
                'from': account.address,
                'nonce': nonce,
                'gas': 300000,
                'gasPrice': w3.eth.gas_price,
                'chainId': 11155111
            })
            signed_swap = account.sign_transaction(swap_tx)
            swap_hash = w3.eth.send_raw_transaction(signed_swap.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(swap_hash, timeout=60)
            
            if receipt['status'] == 0:
                # Transaction reverted - likely paused by agent
                return {
                    "success": True,
                    "blocked": True,
                    "message": "🛡️ Attack was blocked by AMEN agent!",
                    "tx_hash": swap_hash.hex()
                }
            
            # Check price after
            price_after = amm.functions.getSpotPrice().call() / 1e8
            price_deviation = abs(price_after - 2000.0) / 2000.0 * 100
            
            # Record the attack event to the database
            async with async_session_factory() as session:
                # Record the attack as a threat
                attack_event = SecurityEvent(
                    timestamp=datetime.utcnow(),
                    block_number=receipt['blockNumber'],
                    event_type="ASSESSMENT",
                    oracle_price=2000.0,
                    amm_price=price_after,
                    price_deviation=price_deviation,
                    classification="FLASH_LOAN_ATTACK",
                    confidence=0.95,
                    explanation=f"Flash loan attack detected! Price manipulated from ${price_before:.2f} to ${price_after:.2f}",
                    evidence=[f"Price deviation: {price_deviation:.1f}%", f"Attack amount: 5 ETH swap"],
                    action="PAUSE_AMM",
                    action_reason="Large price manipulation detected"
                )
                session.add(attack_event)
                await session.commit()
            
            return {
                "success": True,
                "blocked": False,
                "message": f"💥 Attack executed! Price moved from ${price_before:.2f} to ${price_after:.2f}",
                "tx_hash": swap_hash.hex(),
                "price_before": price_before,
                "price_after": price_after
            }
            
        except Exception as swap_error:
            error_msg = str(swap_error).lower()
            if "paused" in error_msg or "reverted" in error_msg:
                # Record that attack was blocked
                async with async_session_factory() as session:
                    blocked_event = SecurityEvent(
                        timestamp=datetime.utcnow(),
                        block_number=w3.eth.block_number,
                        event_type="AMM_PAUSED",
                        oracle_price=2000.0,
                        amm_price=price_before,
                        price_deviation=0,
                        classification="FLASH_LOAN_ATTACK",
                        confidence=0.95,
                        explanation="🛡️ ATTACK BLOCKED! AMM was already paused by AMEN agent.",
                        evidence=["Attack attempt detected", "AMM paused - swap reverted"],
                        action="PAUSE_AMM",
                        action_reason="Proactive defense - attack blocked",
                        execute_on_chain=True
                    )
                    session.add(blocked_event)
                    await session.commit()
                
                return {
                    "success": True,
                    "blocked": True,
                    "message": "🛡️ Attack was blocked by AMEN agent!"
                }
            raise swap_error
            
    except Exception as e:
        return {"success": False, "blocked": False, "message": f"Attack failed: {str(e)}"}


@app.post("/api/admin/reset-amm")
async def reset_amm():
    """
    Reset the AMM to ~$2000 price using Web3.py
    Performs counter-swaps to rebalance the pool
    """
    try:
        amm_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["AMM"])
        weth_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["WETH"])
        usdc_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["USDC"])
        
        amm = w3.eth.contract(address=amm_address, abi=AMM_ABI)
        weth = w3.eth.contract(address=weth_address, abi=ERC20_ABI)
        usdc = w3.eth.contract(address=usdc_address, abi=ERC20_ABI)
        
        # Get current price and reserves
        current_price = amm.functions.getSpotPrice().call() / 1e8  # Price has 8 decimals
        weth_reserve, usdc_reserve = amm.functions.getReserves().call()
        
        target_price = 2000.0
        
        # If price is already close, no action needed
        if abs(current_price - target_price) / target_price < 0.01:
            return {
                "success": True,
                "message": f"✅ AMM already at target price: ${current_price:.2f}",
                "new_price": current_price
            }
        
        account = get_agent_account()
        nonce = w3.eth.get_transaction_count(account.address)
        
        # Determine swap direction and amount
        if current_price < target_price:
            # Price too low - need to buy WETH with USDC to raise price
            # Calculate how much USDC to swap
            price_ratio = target_price / current_price
            usdc_amount = int(usdc_reserve * (price_ratio - 1) / 2)  # Swap half the difference
            usdc_amount = min(usdc_amount, int(1_000_000 * 1e6))  # Cap at 1M USDC
            
            # Mint USDC
            mint_tx = usdc.functions.mint(account.address, usdc_amount).build_transaction({
                'from': account.address, 'nonce': nonce, 'gas': 100000,
                'gasPrice': w3.eth.gas_price, 'chainId': 11155111
            })
            signed = account.sign_transaction(mint_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            nonce += 1
            
            # Approve
            approve_tx = usdc.functions.approve(amm_address, usdc_amount).build_transaction({
                'from': account.address, 'nonce': nonce, 'gas': 100000,
                'gasPrice': w3.eth.gas_price, 'chainId': 11155111
            })
            signed = account.sign_transaction(approve_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            nonce += 1
            
            # Swap USDC → WETH
            swap_tx = amm.functions.swap(usdc_address, usdc_amount, 0).build_transaction({
                'from': account.address, 'nonce': nonce, 'gas': 300000,
                'gasPrice': w3.eth.gas_price, 'chainId': 11155111
            })
            signed = account.sign_transaction(swap_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            
        else:
            # Price too high - need to sell WETH for USDC to lower price
            price_ratio = current_price / target_price
            weth_amount = int(weth_reserve * (price_ratio - 1) / 2)
            weth_amount = min(weth_amount, Web3.to_wei(50, 'ether'))  # Cap at 50 WETH
            
            # Mint WETH
            mint_tx = weth.functions.mint(account.address, weth_amount).build_transaction({
                'from': account.address, 'nonce': nonce, 'gas': 100000,
                'gasPrice': w3.eth.gas_price, 'chainId': 11155111
            })
            signed = account.sign_transaction(mint_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            nonce += 1
            
            # Approve
            approve_tx = weth.functions.approve(amm_address, weth_amount).build_transaction({
                'from': account.address, 'nonce': nonce, 'gas': 100000,
                'gasPrice': w3.eth.gas_price, 'chainId': 11155111
            })
            signed = account.sign_transaction(approve_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            nonce += 1
            
            # Swap WETH → USDC
            swap_tx = amm.functions.swap(weth_address, weth_amount, 0).build_transaction({
                'from': account.address, 'nonce': nonce, 'gas': 300000,
                'gasPrice': w3.eth.gas_price, 'chainId': 11155111
            })
            signed = account.sign_transaction(swap_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        
        # Check new price
        new_price = amm.functions.getSpotPrice().call() / 1e8
        
        return {
            "success": True,
            "message": f"✅ AMM reset! Price: ${current_price:.2f} → ${new_price:.2f}",
            "new_price": new_price,
            "tx_hash": tx_hash.hex()
        }
        
    except Exception as e:
        return {"success": False, "message": f"Reset failed: {str(e)}"}


@app.post("/api/admin/restore-price")
async def restore_price():
    """
    AUTO-RESTORE: Agent calls this to restore AMM price after attack detection
    Same as reset-amm but with different messaging
    """
    result = await reset_amm()
    if result.get("success"):
        result["message"] = "✅ Price automatically restored!"
    return result


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
    try:
        results = []
        account = get_agent_account()
        nonce = w3.eth.get_transaction_count(account.address)
        
        # Unpause AMM
        try:
            amm_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["AMM"])
            amm = w3.eth.contract(address=amm_address, abi=AMM_ABI)
            
            if amm.functions.paused().call():
                tx = amm.functions.unpause().build_transaction({
                    'from': account.address, 'nonce': nonce, 'gas': 100000,
                    'gasPrice': w3.eth.gas_price, 'chainId': 11155111
                })
                signed = account.sign_transaction(tx)
                tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
                w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
                results.append("AMM unpaused")
                nonce += 1
            else:
                results.append("AMM already unpaused")
        except Exception as e:
            results.append(f"AMM: {str(e)[:50]}")
        
        # Unpause Vault and unblock liquidations
        try:
            vault_address = Web3.to_checksum_address(CONTRACT_ADDRESSES["LENDING_VAULT"])
            vault = w3.eth.contract(address=vault_address, abi=VAULT_ABI)
            
            if vault.functions.paused().call():
                tx = vault.functions.unpause().build_transaction({
                    'from': account.address, 'nonce': nonce, 'gas': 100000,
                    'gasPrice': w3.eth.gas_price, 'chainId': 11155111
                })
                signed = account.sign_transaction(tx)
                tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
                w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
                results.append("Vault unpaused")
                nonce += 1
            else:
                results.append("Vault already unpaused")
                
            if vault.functions.liquidationsBlocked().call():
                tx = vault.functions.unblockLiquidations().build_transaction({
                    'from': account.address, 'nonce': nonce, 'gas': 100000,
                    'gasPrice': w3.eth.gas_price, 'chainId': 11155111
                })
                signed = account.sign_transaction(tx)
                tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
                w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
                results.append("Liquidations unblocked")
                nonce += 1
            else:
                results.append("Liquidations already unblocked")
        except Exception as e:
            results.append(f"Vault: {str(e)[:50]}")
        
        return {
            "success": True,
            "message": "✅ Protocol reset to normal operating state",
            "details": results
        }
        
    except Exception as e:
        return {"success": False, "message": f"Unpause failed: {str(e)}"}


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
