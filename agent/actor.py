"""
AMEN - On-Chain Actor
Executes protective actions on blockchain
"""

from typing import Optional
from web3 import Web3
from web3.middleware import SignAndSendRawMiddlewareBuilder
from eth_account import Account
import structlog

from config import AgentConfig
from decider import PolicyDecision, ActionType
from abis import ORACLE_ABI, AMM_ABI, VAULT_ABI


logger = structlog.get_logger()


class Actor:
    """
    On-chain action executor
    
    Executes protective actions:
    - pause() - Stop all protocol operations
    - blockLiquidations() - Block only liquidations
    - flagManipulation() - Mark oracle manipulation
    
    All actions are signed and broadcast to the blockchain.
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        
        # Setup Web3 with signing middleware
        self.w3 = Web3(Web3.HTTPProvider(config.sepolia_rpc_url))
        
        # Load agent account
        self.account = Account.from_key(config.agent_private_key)
        
        # Add signing middleware
        self.w3.middleware_onion.inject(
            SignAndSendRawMiddlewareBuilder.build(self.account),
            layer=0
        )
        self.w3.eth.default_account = self.account.address
        
        logger.info(
            "Actor initialized",
            agent_address=self.account.address,
            balance=self.w3.eth.get_balance(self.account.address) / 1e18
        )
        
        # Initialize contracts
        self.oracle = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.oracle_address),
            abi=ORACLE_ABI
        )
        
        self.amm = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.amm_pool_address),
            abi=AMM_ABI
        )
        
        self.vault = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.lending_vault_address),
            abi=VAULT_ABI
        )
    
    def _get_gas_params(self) -> dict:
        """Get current gas parameters for transaction"""
        # Get base fee and priority fee
        latest_block = self.w3.eth.get_block('latest')
        base_fee = latest_block.get('baseFeePerGas', self.w3.to_wei(1, 'gwei'))
        
        # Priority fee (tip)
        priority_fee = self.w3.to_wei(1.5, 'gwei')
        
        # Max fee = 2x base fee + priority fee
        max_fee = (base_fee * 2) + priority_fee
        
        return {
            'maxFeePerGas': max_fee,
            'maxPriorityFeePerGas': priority_fee,
        }
    
    async def execute(self, decision: PolicyDecision) -> Optional[str]:
        """
        Execute policy decision on-chain
        
        Args:
            decision: PolicyDecision from PolicyEngine
            
        Returns:
            Transaction hash if executed, None otherwise
        """
        if not decision.execute_on_chain:
            logger.debug("No on-chain action required", action=decision.action.value)
            return None
        
        if decision.action == ActionType.NONE:
            return None
        
        logger.info(
            "Executing on-chain action",
            action=decision.action.value,
            reason=decision.reason[:100]
        )
        
        try:
            if decision.action == ActionType.PAUSE_PROTOCOL:
                return await self._pause_protocol(decision.reason)
            
            elif decision.action == ActionType.BLOCK_LIQUIDATIONS:
                return await self._block_liquidations()
            
            elif decision.action == ActionType.FLAG_ORACLE:
                return await self._flag_oracle(decision.reason)
            
            else:
                logger.debug("Action type not executable", action=decision.action.value)
                return None
                
        except Exception as e:
            logger.error(
                "Failed to execute on-chain action",
                action=decision.action.value,
                error=str(e)
            )
            raise
    
    async def _pause_protocol(self, reason: str) -> str:
        """
        Pause the lending vault
        
        This is the nuclear option - stops all operations.
        """
        logger.warning("🚨 EXECUTING EMERGENCY PAUSE")
        
        # Truncate reason if too long (gas optimization)
        reason_truncated = reason[:200] if len(reason) > 200 else reason
        
        # Build transaction
        gas_params = self._get_gas_params()
        
        tx = self.vault.functions.pause(reason_truncated).build_transaction({
            'from': self.account.address,
            'nonce': self.w3.eth.get_transaction_count(self.account.address),
            'gas': 150000,  # Reasonable gas limit for pause
            **gas_params
        })
        
        # Sign and send
        signed_tx = self.w3.eth.account.sign_transaction(tx, self.config.agent_private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        # Wait for confirmation
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt.status == 1:
            logger.info(
                "✅ Protocol paused successfully",
                tx_hash=tx_hash.hex(),
                block=receipt.blockNumber,
                gas_used=receipt.gasUsed
            )
        else:
            logger.error(
                "❌ Pause transaction failed",
                tx_hash=tx_hash.hex()
            )
        
        return f"0x{tx_hash.hex()}"
    
    async def _block_liquidations(self) -> str:
        """
        Block liquidations only (less severe than full pause)
        """
        logger.warning("⚠️ BLOCKING LIQUIDATIONS")
        
        gas_params = self._get_gas_params()
        
        tx = self.vault.functions.blockLiquidations().build_transaction({
            'from': self.account.address,
            'nonce': self.w3.eth.get_transaction_count(self.account.address),
            'gas': 100000,
            **gas_params
        })
        
        signed_tx = self.w3.eth.account.sign_transaction(tx, self.config.agent_private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt.status == 1:
            logger.info(
                "✅ Liquidations blocked successfully",
                tx_hash=tx_hash.hex(),
                block=receipt.blockNumber
            )
        else:
            logger.error("❌ Block liquidations failed", tx_hash=tx_hash.hex())
        
        return f"0x{tx_hash.hex()}"

    async def pause_amm(self) -> str:
        """
        EMERGENCY: Pause the AMM to prevent manipulation attacks
        This stops all swaps immediately!
        """
        logger.warning("🚨🚨🚨 EMERGENCY AMM PAUSE - BLOCKING ATTACK 🚨🚨🚨")
        
        gas_params = self._get_gas_params()
        
        try:
            tx = self.amm.functions.pause().build_transaction({
                'from': self.account.address,
                'nonce': self.w3.eth.get_transaction_count(self.account.address),
                'gas': 100000,
                **gas_params
            })
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self.config.agent_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                logger.info(
                    "🛡️ AMM PAUSED SUCCESSFULLY - ATTACK BLOCKED!",
                    tx_hash=tx_hash.hex(),
                    block=receipt.blockNumber
                )
            else:
                logger.error("❌ AMM pause failed", tx_hash=tx_hash.hex())
            
            return f"0x{tx_hash.hex()}"
        except Exception as e:
            if "Already paused" in str(e):
                logger.info("AMM already paused - protection active")
                return "already_paused"
            raise

    async def unpause_amm(self) -> str:
        """
        Resume AMM operations after security review
        Only owner can unpause
        """
        logger.info("🔓 Unpausing AMM...")
        
        gas_params = self._get_gas_params()
        
        tx = self.amm.functions.unpause().build_transaction({
            'from': self.account.address,
            'nonce': self.w3.eth.get_transaction_count(self.account.address),
            'gas': 100000,
            **gas_params
        })
        
        signed_tx = self.w3.eth.account.sign_transaction(tx, self.config.agent_private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt.status == 1:
            logger.info("✅ AMM unpaused", tx_hash=tx_hash.hex())
        
        return f"0x{tx_hash.hex()}"
    
    async def _flag_oracle(self, reason: str) -> str:
        """
        Flag potential oracle manipulation
        """
        logger.info("🔮 Flagging oracle manipulation")
        
        reason_truncated = reason[:200] if len(reason) > 200 else reason
        
        gas_params = self._get_gas_params()
        
        tx = self.oracle.functions.flagManipulation(reason_truncated).build_transaction({
            'from': self.account.address,
            'nonce': self.w3.eth.get_transaction_count(self.account.address),
            'gas': 100000,
            **gas_params
        })
        
        signed_tx = self.w3.eth.account.sign_transaction(tx, self.config.agent_private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt.status == 1:
            logger.info(
                "✅ Oracle manipulation flagged",
                tx_hash=tx_hash.hex()
            )
        
        return f"0x{tx_hash.hex()}"
    
    def check_balance(self) -> float:
        """Check agent wallet balance"""
        balance = self.w3.eth.get_balance(self.account.address)
        return balance / 1e18
    
    def get_nonce(self) -> int:
        """Get current nonce for agent account"""
        return self.w3.eth.get_transaction_count(self.account.address)
