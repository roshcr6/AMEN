"""
AMEN Backend - Database Models
SQLAlchemy models for security event storage
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

Base = declarative_base()


class SecurityEvent(Base):
    """
    Security event record
    Stores all events from the agent for analysis and display
    """
    __tablename__ = "security_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    block_number = Column(Integer, index=True)
    event_type = Column(String(50), index=True)  # OBSERVATION, ASSESSMENT, DECISION, ACTION
    
    # Market data
    oracle_price = Column(Float)
    amm_price = Column(Float)
    price_deviation = Column(Float)
    
    # Assessment data
    classification = Column(String(50), nullable=True, index=True)
    confidence = Column(Float, nullable=True)
    explanation = Column(Text, nullable=True)
    evidence = Column(JSON, nullable=True)
    
    # Decision data
    action = Column(String(50), nullable=True, index=True)
    action_reason = Column(Text, nullable=True)
    execute_on_chain = Column(Boolean, nullable=True)
    
    # Execution data
    tx_hash = Column(String(66), nullable=True, index=True)
    
    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "block_number": self.block_number,
            "event_type": self.event_type,
            "oracle_price": self.oracle_price,
            "amm_price": self.amm_price,
            "price_deviation": self.price_deviation,
            "classification": self.classification,
            "confidence": self.confidence,
            "explanation": self.explanation,
            "evidence": self.evidence,
            "action": self.action,
            "action_reason": self.action_reason,
            "execute_on_chain": self.execute_on_chain,
            "tx_hash": self.tx_hash
        }


class MarketSnapshot(Base):
    """
    Market state snapshot
    Regular snapshots for charting and analysis
    """
    __tablename__ = "market_snapshots"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    block_number = Column(Integer, index=True)
    
    # Prices
    oracle_price = Column(Float)
    amm_price = Column(Float)
    oracle_twap = Column(Float, nullable=True)
    
    # Reserves
    weth_reserve = Column(Float)
    usdc_reserve = Column(Float)
    
    # Protocol state
    total_collateral = Column(Float)
    total_loans = Column(Float)
    vault_paused = Column(Boolean, default=False)
    liquidations_blocked = Column(Boolean, default=False)
    
    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "block_number": self.block_number,
            "oracle_price": self.oracle_price,
            "amm_price": self.amm_price,
            "oracle_twap": self.oracle_twap,
            "weth_reserve": self.weth_reserve,
            "usdc_reserve": self.usdc_reserve,
            "total_collateral": self.total_collateral,
            "total_loans": self.total_loans,
            "vault_paused": self.vault_paused,
            "liquidations_blocked": self.liquidations_blocked
        }


class AgentAction(Base):
    """
    On-chain actions taken by the agent
    """
    __tablename__ = "agent_actions"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    block_number = Column(Integer)
    
    action_type = Column(String(50))  # PAUSE_PROTOCOL, BLOCK_LIQUIDATIONS, FLAG_ORACLE
    tx_hash = Column(String(66), unique=True)
    
    # Trigger info
    trigger_classification = Column(String(50))
    trigger_confidence = Column(Float)
    trigger_reason = Column(Text)
    
    # Result
    success = Column(Boolean)
    gas_used = Column(Integer, nullable=True)
    
    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "block_number": self.block_number,
            "action_type": self.action_type,
            "tx_hash": self.tx_hash,
            "trigger_classification": self.trigger_classification,
            "trigger_confidence": self.trigger_confidence,
            "trigger_reason": self.trigger_reason,
            "success": self.success,
            "gas_used": self.gas_used
        }


# Database setup
def get_database_url(use_async: bool = True) -> str:
    """Get database URL from environment or default"""
    import os
    db_url = os.getenv("DATABASE_URL", "sqlite:///./amen_security.db")
    
    if use_async and db_url.startswith("sqlite:"):
        # Convert to async SQLite URL
        db_url = db_url.replace("sqlite:", "sqlite+aiosqlite:")
    
    return db_url


def create_tables():
    """Create all database tables (sync)"""
    db_url = get_database_url(use_async=False)
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    return engine


async def get_async_session():
    """Get async database session"""
    db_url = get_database_url(use_async=True)
    engine = create_async_engine(db_url, echo=False)
    
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        yield session
