"""
AMEN Agent Configuration
Environment-based configuration with validation
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
import os
from pathlib import Path


class AgentConfig(BaseSettings):
    """
    Configuration for the AMEN Security Agent
    All values loaded from environment variables
    """
    
    # ==========================================================================
    # Blockchain Configuration
    # ==========================================================================
    
    sepolia_rpc_url: str = Field(
        ...,
        description="Sepolia RPC URL (Alchemy/Infura)"
    )
    
    chain_id: int = Field(
        default=11155111,
        description="Chain ID (11155111 for Sepolia)"
    )
    
    # ==========================================================================
    # Wallet Configuration
    # ==========================================================================
    
    agent_private_key: str = Field(
        ...,
        description="Agent wallet private key for signing transactions"
    )
    
    # ==========================================================================
    # Contract Addresses
    # ==========================================================================
    
    weth_address: str = Field(
        ...,
        description="WETH token contract address"
    )
    
    usdc_address: str = Field(
        ...,
        description="USDC token contract address"
    )
    
    oracle_address: str = Field(
        ...,
        description="Price oracle contract address"
    )
    
    amm_pool_address: str = Field(
        ...,
        description="AMM pool contract address"
    )
    
    lending_vault_address: str = Field(
        ...,
        description="Lending vault contract address"
    )
    
    # ==========================================================================
    # AI Configuration (Vertex AI)
    # ==========================================================================
    
    gemini_api_key: str = Field(
        ...,
        description="Vertex AI API key"
    )
    
    gemini_model: str = Field(
        default="gemini-1.5-pro",
        description="Gemini model to use for analysis"
    )
    
    vertex_project_id: str = Field(
        default="defnd-483112-c7",
        description="Google Cloud Project ID for Vertex AI"
    )
    
    vertex_location: str = Field(
        default="us-central1",
        description="Vertex AI location/region"
    )
    
    # ==========================================================================
    # Agent Behavior
    # ==========================================================================
    
    poll_interval: int = Field(
        default=3,  # FAST polling for attack detection
        description="Seconds between monitoring cycles (3s for rapid response)"
    )
    
    price_deviation_threshold: float = Field(
        default=0.03,  # 3% threshold - more sensitive
        description="Price deviation threshold (3% = 0.03)"
    )
    
    pause_confidence_threshold: float = Field(
        default=0.65,  # Lower threshold for faster response
        description="Confidence threshold for emergency pause"
    )
    
    block_liquidation_threshold: float = Field(
        default=0.50,  # Lower threshold for faster response
        description="Confidence threshold for blocking liquidations"
    )
    
    # Proactive defense thresholds
    proactive_pause_deviation: float = Field(
        default=0.30,  # 30% deviation triggers immediate AMM pause (lowered from 50%)
        description="Deviation threshold for immediate AMM pause (no LLM needed)"
    )
    
    rapid_response_mode: bool = Field(
        default=True,
        description="Enable rapid response mode for faster attack blocking"
    )
    
    price_history_window: int = Field(
        default=20,
        description="Number of price points to analyze"
    )
    
    # ==========================================================================
    # Backend Configuration
    # ==========================================================================
    
    backend_url: str = Field(
        default="http://localhost:8080",
        description="Backend API URL for logging"
    )
    
    # ==========================================================================
    # Logging
    # ==========================================================================
    
    log_level: str = Field(
        default="INFO",
        description="Logging level"
    )
    
    enable_tx_logging: bool = Field(
        default=True,
        description="Enable detailed transaction logging"
    )
    
    class Config:
        env_file = "../.env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields from .env


def load_config() -> AgentConfig:
    """Load and validate configuration"""
    from dotenv import load_dotenv
    
    # Try to load from current directory .env first (agent/.env)
    local_env = Path(__file__).parent / ".env"
    if local_env.exists():
        load_dotenv(local_env)
    
    # Then try parent directory .env (root/.env)
    root_env = Path(__file__).parent.parent / ".env"
    if root_env.exists():
        load_dotenv(root_env, override=False)  # Don't override local
    
    return AgentConfig()
