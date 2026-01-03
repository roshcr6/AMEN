// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Mock price oracle for testing manipulation detection
 * @dev This oracle is intentionally manipulatable to simulate attacks
 * 
 * SECURITY ARCHITECTURE:
 * - Price updates emit events for off-chain monitoring
 * - Historical prices stored for TWAP calculations
 * - Owner can set prices (simulating compromised oracle scenario)
 * - Agent can flag suspicious updates
 * 
 * In production, use Chainlink or similar decentralized oracles.
 */
contract PriceOracle is Ownable {
    // ==========================================================================
    // EVENTS - Critical for agent monitoring
    // ==========================================================================
    
    /// @notice Emitted on every price update - agent monitors this
    event PriceUpdated(
        uint256 indexed timestamp,
        uint256 oldPrice,
        uint256 newPrice,
        uint256 percentageChange,
        address indexed updater
    );
    
    /// @notice Emitted when manipulation is suspected
    event ManipulationFlagged(
        uint256 indexed timestamp,
        uint256 price,
        string reason
    );
    
    // ==========================================================================
    // STATE VARIABLES
    // ==========================================================================
    
    /// @notice Current ETH/USD price (8 decimals like Chainlink)
    uint256 public price;
    
    /// @notice Last update timestamp
    uint256 public lastUpdateTimestamp;
    
    /// @notice Last update block number - critical for same-block detection
    uint256 public lastUpdateBlock;
    
    /// @notice Historical price entries for TWAP
    struct PriceEntry {
        uint256 price;
        uint256 timestamp;
        uint256 blockNumber;
    }
    
    /// @notice Rolling window of price history (last 20 updates)
    PriceEntry[20] public priceHistory;
    uint256 public historyIndex;
    
    /// @notice Number of updates in current block - manipulation indicator
    uint256 public updatesThisBlock;
    uint256 private lastCountedBlock;
    
    /// @notice Authorized price updaters (simulating oracle nodes)
    mapping(address => bool) public authorizedUpdaters;
    
    /// @notice Security agent address - can flag manipulations
    address public securityAgent;
    
    /// @notice Maximum allowed single-update price change (5% = 500 basis points)
    uint256 public constant MAX_PRICE_CHANGE_BPS = 500;
    
    /// @notice Price decimals (matches Chainlink standard)
    uint8 public constant DECIMALS = 8;
    
    // ==========================================================================
    // CONSTRUCTOR
    // ==========================================================================
    
    /**
     * @param initialPrice Initial ETH/USD price (8 decimals)
     * @dev Example: $2000 = 2000 * 10^8 = 200000000000
     */
    constructor(uint256 initialPrice) Ownable(msg.sender) {
        require(initialPrice > 0, "Price must be positive");
        
        price = initialPrice;
        lastUpdateTimestamp = block.timestamp;
        lastUpdateBlock = block.number;
        
        // Initialize history with initial price
        priceHistory[0] = PriceEntry({
            price: initialPrice,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        historyIndex = 1;
        
        // Owner is initial authorized updater
        authorizedUpdaters[msg.sender] = true;
    }
    
    // ==========================================================================
    // MODIFIERS
    // ==========================================================================
    
    modifier onlyAuthorized() {
        require(
            authorizedUpdaters[msg.sender] || msg.sender == owner(),
            "Not authorized to update price"
        );
        _;
    }
    
    // ==========================================================================
    // PRICE UPDATE FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Update the oracle price
     * @param newPrice New ETH/USD price (8 decimals)
     * @dev Emits events for agent monitoring, tracks same-block updates
     * 
     * SECURITY: This function is intentionally permissive for attack simulation.
     * Real oracles have multi-sig, time-locks, and deviation checks.
     */
    function updatePrice(uint256 newPrice) external onlyAuthorized {
        require(newPrice > 0, "Price must be positive");
        
        uint256 oldPrice = price;
        
        // Calculate percentage change (basis points for precision)
        uint256 percentageChange;
        if (oldPrice > 0) {
            if (newPrice > oldPrice) {
                percentageChange = ((newPrice - oldPrice) * 10000) / oldPrice;
            } else {
                percentageChange = ((oldPrice - newPrice) * 10000) / oldPrice;
            }
        }
        
        // Track same-block updates (manipulation indicator)
        if (block.number == lastCountedBlock) {
            updatesThisBlock++;
        } else {
            lastCountedBlock = block.number;
            updatesThisBlock = 1;
        }
        
        // Store in history
        priceHistory[historyIndex % 20] = PriceEntry({
            price: newPrice,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        historyIndex++;
        
        // Update state
        price = newPrice;
        lastUpdateTimestamp = block.timestamp;
        lastUpdateBlock = block.number;
        
        // Emit event for agent monitoring
        emit PriceUpdated(
            block.timestamp,
            oldPrice,
            newPrice,
            percentageChange,
            msg.sender
        );
    }
    
    /**
     * @notice Force price update (simulates oracle compromise)
     * @param newPrice New price to set
     * @dev DANGEROUS: Only for attack simulation. Bypasses checks.
     */
    function forceUpdatePrice(uint256 newPrice) external onlyOwner {
        uint256 oldPrice = price;
        price = newPrice;
        lastUpdateTimestamp = block.timestamp;
        lastUpdateBlock = block.number;
        
        uint256 percentageChange = 0;
        if (oldPrice > 0) {
            if (newPrice > oldPrice) {
                percentageChange = ((newPrice - oldPrice) * 10000) / oldPrice;
            } else {
                percentageChange = ((oldPrice - newPrice) * 10000) / oldPrice;
            }
        }
        
        emit PriceUpdated(
            block.timestamp,
            oldPrice,
            newPrice,
            percentageChange,
            msg.sender
        );
    }
    
    // ==========================================================================
    // PRICE QUERY FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Get current price with metadata
     * @return _price Current price
     * @return _timestamp Last update timestamp
     * @return _blockNumber Last update block
     */
    function getPrice() external view returns (
        uint256 _price,
        uint256 _timestamp,
        uint256 _blockNumber
    ) {
        return (price, lastUpdateTimestamp, lastUpdateBlock);
    }
    
    /**
     * @notice Get latest price (Chainlink-compatible interface)
     * @return roundId Always returns 1 (mock)
     * @return answer Current price
     * @return startedAt Update timestamp
     * @return updatedAt Update timestamp  
     * @return answeredInRound Always returns 1 (mock)
     */
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (
            1,
            int256(price),
            lastUpdateTimestamp,
            lastUpdateTimestamp,
            1
        );
    }
    
    /**
     * @notice Calculate Time-Weighted Average Price over history
     * @return twap The TWAP value
     * @return sampleCount Number of samples used
     */
    function getTWAP() external view returns (uint256 twap, uint256 sampleCount) {
        uint256 totalPrice = 0;
        uint256 count = 0;
        
        for (uint256 i = 0; i < 20; i++) {
            if (priceHistory[i].timestamp > 0) {
                totalPrice += priceHistory[i].price;
                count++;
            }
        }
        
        if (count == 0) return (price, 1);
        return (totalPrice / count, count);
    }
    
    /**
     * @notice Get price history for analysis
     * @param count Number of recent entries to return
     * @return prices Array of recent prices
     * @return timestamps Array of timestamps
     * @return blockNumbers Array of block numbers
     */
    function getPriceHistory(uint256 count) external view returns (
        uint256[] memory prices,
        uint256[] memory timestamps,
        uint256[] memory blockNumbers
    ) {
        uint256 actualCount = count > 20 ? 20 : count;
        prices = new uint256[](actualCount);
        timestamps = new uint256[](actualCount);
        blockNumbers = new uint256[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            uint256 idx = (historyIndex - 1 - i) % 20;
            if (priceHistory[idx].timestamp > 0) {
                prices[i] = priceHistory[idx].price;
                timestamps[i] = priceHistory[idx].timestamp;
                blockNumbers[i] = priceHistory[idx].blockNumber;
            }
        }
        
        return (prices, timestamps, blockNumbers);
    }
    
    // ==========================================================================
    // SECURITY FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Set the security agent address
     * @param _agent Agent address
     */
    function setSecurityAgent(address _agent) external onlyOwner {
        securityAgent = _agent;
    }
    
    /**
     * @notice Flag potential manipulation (called by agent)
     * @param reason Description of suspicious activity
     */
    function flagManipulation(string calldata reason) external {
        require(
            msg.sender == securityAgent || msg.sender == owner(),
            "Only agent can flag"
        );
        
        emit ManipulationFlagged(block.timestamp, price, reason);
    }
    
    /**
     * @notice Add authorized price updater
     * @param updater Address to authorize
     */
    function addAuthorizedUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = true;
    }
    
    /**
     * @notice Remove authorized price updater
     * @param updater Address to revoke
     */
    function removeAuthorizedUpdater(address updater) external onlyOwner {
        authorizedUpdaters[updater] = false;
    }
}
