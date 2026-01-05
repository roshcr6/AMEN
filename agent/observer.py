"""
AMEN - On-Chain Observer
Collects real-time data from blockchain for threat analysis
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from web3 import Web3
from web3.contract import Contract
import structlog

from config import AgentConfig
from abis import ORACLE_ABI, AMM_ABI, VAULT_ABI


logger = structlog.get_logger()


@dataclass
class PriceData:
    """Oracle price data point"""
    price: float  # USD with 8 decimals normalized
    timestamp: int
    block_number: int


@dataclass
class AMMState:
    """AMM pool state"""
    weth_reserve: float
    usdc_reserve: float
    spot_price: float
    swaps_this_block: int
    block_number: int
    is_paused: bool = False


@dataclass 
class VaultState:
    """Lending vault state"""
    total_collateral: float
    total_loans: float
    is_paused: bool
    liquidations_blocked: bool
    liquidations_this_block: int


@dataclass
class MarketSnapshot:
    """Complete market state at a point in time"""
    timestamp: datetime
    block_number: int
    
    # Oracle data
    oracle_price: float
    oracle_twap: float
    oracle_updates_this_block: int
    
    # AMM data
    amm_spot_price: float
    weth_reserve: float
    usdc_reserve: float
    amm_swaps_this_block: int
    
    # Derived metrics
    price_deviation_pct: float  # Oracle vs AMM
    
    # Protocol state
    vault_total_collateral: float
    vault_total_loans: float
    vault_paused: bool
    liquidations_blocked: bool
    
    # Fields with defaults must come last
    amm_paused: bool = False  # AMM emergency pause state
    
    # Recent events
    recent_liquidations: List[Dict[str, Any]] = field(default_factory=list)
    recent_large_swaps: List[Dict[str, Any]] = field(default_factory=list)
    price_history: List[PriceData] = field(default_factory=list)


class Observer:
    """
    On-chain data observer for threat detection
    
    Collects:
    - Oracle prices (current + history)
    - AMM reserves and swap activity
    - Vault state and liquidation events
    - Block-level anomalies
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        self.w3 = Web3(Web3.HTTPProvider(config.sepolia_rpc_url))
        
        if not self.w3.is_connected():
            raise ConnectionError(f"Failed to connect to {config.sepolia_rpc_url}")
        
        logger.info("Connected to blockchain", 
                   chain_id=self.w3.eth.chain_id,
                   block=self.w3.eth.block_number)
        
        # Initialize contracts
        self.oracle: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.oracle_address),
            abi=ORACLE_ABI
        )
        
        self.amm: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.amm_pool_address),
            abi=AMM_ABI
        )
        
        self.vault: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.lending_vault_address),
            abi=VAULT_ABI
        )
        
        # State tracking
        self.last_block = 0
        self.price_history: List[PriceData] = []
        self.snapshot_history: List[MarketSnapshot] = []
        
    def get_oracle_price(self) -> PriceData:
        """Get current oracle price with metadata"""
        price, timestamp, block = self.oracle.functions.getPrice().call()
        return PriceData(
            price=price / 1e8,  # Convert from 8 decimals
            timestamp=timestamp,
            block_number=block
        )
    
    def get_oracle_twap(self) -> float:
        """Get Time-Weighted Average Price"""
        try:
            twap, sample_count = self.oracle.functions.getTWAP().call()
            if sample_count == 0:
                # No samples yet, return current price
                price = self.oracle.functions.getPrice().call()
                return price[0] / 1e8
            return twap / 1e8
        except Exception as e:
            logger.warning(f"Could not get TWAP: {e}")
            # Fallback to current price
            price = self.oracle.functions.getPrice().call()
            return price[0] / 1e8
    
    def get_price_history(self, count: int = 20) -> List[PriceData]:
        """Get historical price data"""
        try:
            prices, timestamps, blocks = self.oracle.functions.getPriceHistory(count).call()
            
            history = []
            for i in range(len(prices)):
                if timestamps[i] > 0:  # Valid entry
                    history.append(PriceData(
                        price=prices[i] / 1e8,
                        timestamp=timestamps[i],
                        block_number=blocks[i]
                    ))
            return history
        except Exception as e:
            # Not enough history yet - return empty (expected for new deployments)
            if "underflow or overflow" in str(e):
                logger.debug(f"Price history unavailable (oracle needs more data points)")
            else:
                logger.warning(f"Could not get price history: {e}")
            return []
    
    def get_amm_state(self) -> AMMState:
        """Get AMM pool state"""
        weth, usdc, spot = self.amm.functions.getReserves().call()
        swaps, block = self.amm.functions.getBlockSwapStats().call()
        
        # Check if AMM is paused
        try:
            is_paused = self.amm.functions.paused().call()
        except:
            is_paused = False
        
        return AMMState(
            weth_reserve=weth / 1e18,  # WETH: 18 decimals
            usdc_reserve=usdc / 1e6,   # USDC: 6 decimals
            spot_price=spot / 1e8,     # Price: 8 decimals
            swaps_this_block=swaps,
            block_number=block,
            is_paused=is_paused
        )
    
    def get_vault_state(self) -> VaultState:
        """Get lending vault state"""
        total_collateral = self.vault.functions.totalCollateral().call()
        total_loans = self.vault.functions.totalLoans().call()
        is_paused = self.vault.functions.paused().call()
        liquidations_blocked = self.vault.functions.liquidationsBlocked().call()
        
        # Try to get liquidations this block (may fail if not exposed)
        try:
            liquidations_this_block = self.vault.functions.liquidationsThisBlock().call()
        except:
            liquidations_this_block = 0
        
        return VaultState(
            total_collateral=total_collateral / 1e18,
            total_loans=total_loans / 1e6,
            is_paused=is_paused,
            liquidations_blocked=liquidations_blocked,
            liquidations_this_block=liquidations_this_block
        )
    
    def get_recent_liquidations(self, blocks_back: int = 10) -> List[Dict[str, Any]]:
        """Get recent liquidation events"""
        current_block = self.w3.eth.block_number
        from_block = max(0, current_block - blocks_back)
        
        try:
            events = self.vault.events.Liquidation.get_logs(
                from_block=from_block,
                to_block=current_block
            )
            
            return [{
                "liquidator": event.args.liquidator,
                "user": event.args.user,
                "debt_repaid": event.args.debtRepaid / 1e6,
                "collateral_seized": event.args.collateralSeized / 1e18,
                "oracle_price": event.args.oraclePrice / 1e8,
                "block": event.args.blockNumber,
                "timestamp": event.args.timestamp
            } for event in events]
        except Exception as e:
            # Empty results or rate limiting - not critical
            if "400" in str(e) or "Bad Request" in str(e):
                logger.debug("No liquidation events (expected if no activity)")
            else:
                logger.warning("Failed to get liquidation events", error=str(e))
            return []
    
    def get_recent_swaps(self, blocks_back: int = 10) -> List[Dict[str, Any]]:
        """Get recent AMM swap events"""
        current_block = self.w3.eth.block_number
        from_block = max(0, current_block - blocks_back)
        
        try:
            events = self.amm.events.Swap.get_logs(
                from_block=from_block,
                to_block=current_block
            )
            
            return [{
                "sender": event.args.sender,
                "amount_in": event.args.amountIn / 1e18 if event.args.isWethToUsdc else event.args.amountIn / 1e6,
                "amount_out": event.args.amountOut / 1e6 if event.args.isWethToUsdc else event.args.amountOut / 1e18,
                "is_weth_to_usdc": event.args.isWethToUsdc,
                "effective_price": event.args.effectivePrice / 1e18,
                "block": event.args.blockNumber
            } for event in events]
        except Exception as e:
            # Empty results or rate limiting - not critical
            if "400" in str(e) or "Bad Request" in str(e):
                logger.debug("No swap events (expected if no activity)")
            else:
                logger.warning("Failed to get swap events", error=str(e))
            return []
    
    def calculate_price_deviation(self, oracle_price: float, amm_price: float) -> float:
        """Calculate percentage deviation between oracle and AMM prices"""
        if oracle_price == 0:
            return 0
        return abs(oracle_price - amm_price) / oracle_price * 100
    
    def observe(self) -> MarketSnapshot:
        """
        Take a complete market snapshot
        This is the main observation function called each cycle
        """
        current_block = self.w3.eth.block_number
        
        # Collect all data
        oracle_data = self.get_oracle_price()
        oracle_twap = self.get_oracle_twap()
        amm_state = self.get_amm_state()
        vault_state = self.get_vault_state()
        
        # Get oracle updates this block
        try:
            oracle_updates = self.oracle.functions.updatesThisBlock().call()
        except:
            oracle_updates = 0
        
        # Calculate derived metrics
        price_deviation = self.calculate_price_deviation(
            oracle_data.price,
            amm_state.spot_price
        )
        
        # Get historical data
        price_history = self.get_price_history(self.config.price_history_window)
        recent_liquidations = self.get_recent_liquidations()
        recent_swaps = self.get_recent_swaps()
        
        # Filter for large swaps (> 10 WETH equivalent)
        large_swaps = [s for s in recent_swaps if s["amount_in"] > 10]
        
        # Create snapshot
        snapshot = MarketSnapshot(
            timestamp=datetime.now(),
            block_number=current_block,
            
            oracle_price=oracle_data.price,
            oracle_twap=oracle_twap,
            oracle_updates_this_block=oracle_updates,
            
            amm_spot_price=amm_state.spot_price,
            weth_reserve=amm_state.weth_reserve,
            usdc_reserve=amm_state.usdc_reserve,
            amm_swaps_this_block=amm_state.swaps_this_block,
            amm_paused=amm_state.is_paused,
            
            price_deviation_pct=price_deviation,
            
            vault_total_collateral=vault_state.total_collateral,
            vault_total_loans=vault_state.total_loans,
            vault_paused=vault_state.is_paused,
            liquidations_blocked=vault_state.liquidations_blocked,
            
            recent_liquidations=recent_liquidations,
            recent_large_swaps=large_swaps,
            price_history=price_history
        )
        
        # Store in history
        self.snapshot_history.append(snapshot)
        if len(self.snapshot_history) > 100:  # Keep last 100 snapshots
            self.snapshot_history.pop(0)
        
        self.last_block = current_block
        
        logger.info(
            "Market snapshot",
            block=current_block,
            oracle_price=f"${oracle_data.price:.2f}",
            amm_price=f"${amm_state.spot_price:.2f}",
            deviation=f"{price_deviation:.2f}%",
            swaps_this_block=amm_state.swaps_this_block
        )
        
        return snapshot
    
    def get_analysis_context(self, snapshot: MarketSnapshot) -> Dict[str, Any]:
        """
        Prepare structured context for LLM analysis
        Returns facts the LLM should consider
        """
        # Calculate price changes
        price_changes = []
        if len(snapshot.price_history) >= 2:
            for i in range(1, min(5, len(snapshot.price_history))):
                prev = snapshot.price_history[i].price
                curr = snapshot.price_history[i-1].price
                change_pct = (curr - prev) / prev * 100 if prev > 0 else 0
                price_changes.append({
                    "from_block": snapshot.price_history[i].block_number,
                    "to_block": snapshot.price_history[i-1].block_number,
                    "change_pct": round(change_pct, 2)
                })
        
        # Check for same-block recovery pattern
        same_block_recovery = False
        if len(snapshot.price_history) >= 3:
            prices = [p.price for p in snapshot.price_history[:3]]
            blocks = [p.block_number for p in snapshot.price_history[:3]]
            # Check if price dropped and recovered in same or adjacent block
            if len(set(blocks)) <= 2:  # All within 2 blocks
                max_price = max(prices)
                min_price = min(prices)
                if max_price > 0 and (max_price - min_price) / max_price > 0.1:
                    same_block_recovery = True
        
        return {
            "current_state": {
                "block_number": snapshot.block_number,
                "timestamp": snapshot.timestamp.isoformat(),
                "oracle_price_usd": round(snapshot.oracle_price, 2),
                "amm_spot_price_usd": round(snapshot.amm_spot_price, 2),
                "oracle_twap_usd": round(snapshot.oracle_twap, 2),
                "price_deviation_pct": round(snapshot.price_deviation_pct, 2)
            },
            "activity_metrics": {
                "oracle_updates_this_block": snapshot.oracle_updates_this_block,
                "amm_swaps_this_block": snapshot.amm_swaps_this_block,
                "recent_large_swaps_count": len(snapshot.recent_large_swaps),
                "recent_liquidations_count": len(snapshot.recent_liquidations)
            },
            "pool_health": {
                "weth_reserve": round(snapshot.weth_reserve, 4),
                "usdc_reserve": round(snapshot.usdc_reserve, 2),
                "total_vault_collateral_weth": round(snapshot.vault_total_collateral, 4),
                "total_vault_loans_usdc": round(snapshot.vault_total_loans, 2)
            },
            "security_status": {
                "vault_paused": snapshot.vault_paused,
                "liquidations_blocked": snapshot.liquidations_blocked
            },
            "anomaly_indicators": {
                "price_deviation_above_threshold": snapshot.price_deviation_pct > self.config.price_deviation_threshold * 100,
                "multiple_oracle_updates_same_block": snapshot.oracle_updates_this_block > 1,
                "multiple_swaps_same_block": snapshot.amm_swaps_this_block > 2,
                "same_block_price_recovery_pattern": same_block_recovery,
                "liquidation_after_price_drop": len(snapshot.recent_liquidations) > 0 and len(price_changes) > 0 and any(c["change_pct"] < -5 for c in price_changes)
            },
            "recent_price_changes": price_changes,
            "recent_large_swaps": snapshot.recent_large_swaps[:5],
            "recent_liquidations": snapshot.recent_liquidations[:5]
        }
