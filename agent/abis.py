"""
AMEN Contract ABIs
Minimal ABI definitions for contract interaction
"""

# =============================================================================
# PRICE ORACLE ABI
# =============================================================================

ORACLE_ABI = [
    {
        "inputs": [],
        "name": "price",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getPrice",
        "outputs": [
            {"name": "_price", "type": "uint256"},
            {"name": "_timestamp", "type": "uint256"},
            {"name": "_blockNumber", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getTWAP",
        "outputs": [
            {"name": "twap", "type": "uint256"},
            {"name": "sampleCount", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "count", "type": "uint256"}],
        "name": "getPriceHistory",
        "outputs": [
            {"name": "prices", "type": "uint256[]"},
            {"name": "timestamps", "type": "uint256[]"},
            {"name": "blockNumbers", "type": "uint256[]"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "updatesThisBlock",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "reason", "type": "string"}],
        "name": "flagManipulation",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    # Events
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "oldPrice", "type": "uint256"},
            {"indexed": False, "name": "newPrice", "type": "uint256"},
            {"indexed": False, "name": "percentageChange", "type": "uint256"},
            {"indexed": True, "name": "updater", "type": "address"}
        ],
        "name": "PriceUpdated",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "price", "type": "uint256"},
            {"indexed": False, "name": "reason", "type": "string"}
        ],
        "name": "ManipulationFlagged",
        "type": "event"
    }
]

# =============================================================================
# AMM ABI
# =============================================================================

AMM_ABI = [
    {
        "inputs": [],
        "name": "getReserves",
        "outputs": [
            {"name": "_wethReserve", "type": "uint256"},
            {"name": "_usdcReserve", "type": "uint256"},
            {"name": "spotPrice", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getSpotPrice",
        "outputs": [{"name": "price", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getBlockSwapStats",
        "outputs": [
            {"name": "count", "type": "uint256"},
            {"name": "blockNumber", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "swapsThisBlock",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "", "type": "uint256"}],
        "name": "blockSnapshots",
        "outputs": [
            {"name": "wethReserve", "type": "uint256"},
            {"name": "usdcReserve", "type": "uint256"},
            {"name": "swapCount", "type": "uint256"},
            {"name": "totalVolumeWeth", "type": "uint256"},
            {"name": "exists", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    # Events
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "sender", "type": "address"},
            {"indexed": False, "name": "amountIn", "type": "uint256"},
            {"indexed": False, "name": "amountOut", "type": "uint256"},
            {"indexed": False, "name": "isWethToUsdc", "type": "bool"},
            {"indexed": False, "name": "newWethReserve", "type": "uint256"},
            {"indexed": False, "name": "newUsdcReserve", "type": "uint256"},
            {"indexed": False, "name": "effectivePrice", "type": "uint256"},
            {"indexed": False, "name": "blockNumber", "type": "uint256"}
        ],
        "name": "Swap",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "by", "type": "address"},
            {"indexed": False, "name": "timestamp", "type": "uint256"}
        ],
        "name": "EmergencyPaused",
        "type": "event"
    }
]

# =============================================================================
# LENDING VAULT ABI
# =============================================================================

VAULT_ABI = [
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "getPosition",
        "outputs": [
            {"name": "collateral", "type": "uint256"},
            {"name": "debt", "type": "uint256"},
            {"name": "healthFactor", "type": "uint256"},
            {"name": "collateralValueUsd", "type": "uint256"},
            {"name": "maxBorrow", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "getHealthFactor",
        "outputs": [{"name": "healthFactor", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "isLiquidatable",
        "outputs": [
            {"name": "isLiquidatable_", "type": "bool"},
            {"name": "healthFactor", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "liquidationsBlocked",
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"name": "reason", "type": "string"}],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "blockLiquidations",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalCollateral",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalLoans",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "liquidationsThisBlock",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    # Events
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "liquidator", "type": "address"},
            {"indexed": True, "name": "user", "type": "address"},
            {"indexed": False, "name": "debtRepaid", "type": "uint256"},
            {"indexed": False, "name": "collateralSeized", "type": "uint256"},
            {"indexed": False, "name": "oraclePrice", "type": "uint256"},
            {"indexed": False, "name": "blockNumber", "type": "uint256"},
            {"indexed": False, "name": "timestamp", "type": "uint256"}
        ],
        "name": "Liquidation",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "by", "type": "address"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
            {"indexed": False, "name": "reason", "type": "string"}
        ],
        "name": "EmergencyPaused",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "by", "type": "address"},
            {"indexed": False, "name": "timestamp", "type": "uint256"}
        ],
        "name": "LiquidationsBlocked",
        "type": "event"
    }
]
