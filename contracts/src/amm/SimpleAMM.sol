// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleAMM
 * @notice Constant Product AMM (x * y = k) for WETH/USDC pair
 * @dev Designed for manipulation detection - emits detailed events
 * 
 * SECURITY ARCHITECTURE:
 * - Events emitted for every state change (agent monitoring)
 * - Reserve snapshots stored per block (manipulation detection)
 * - Same-block swap tracking (flash loan indicator)
 * - Emergency pause capability
 * 
 * ATTACK VECTORS THIS AMM IS VULNERABLE TO:
 * 1. Flash loan price manipulation
 * 2. Sandwich attacks
 * 3. Just-in-time liquidity attacks
 * 
 * These vulnerabilities are INTENTIONAL for security testing.
 */
contract SimpleAMM is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    // ==========================================================================
    // EVENTS - Critical for agent monitoring
    // ==========================================================================
    
    /// @notice Emitted on every swap - primary monitoring signal
    event Swap(
        address indexed sender,
        uint256 amountIn,
        uint256 amountOut,
        bool isWethToUsdc,
        uint256 newWethReserve,
        uint256 newUsdcReserve,
        uint256 effectivePrice,
        uint256 blockNumber
    );
    
    /// @notice Emitted on liquidity changes
    event LiquidityAdded(
        address indexed provider,
        uint256 wethAmount,
        uint256 usdcAmount,
        uint256 lpTokensMinted
    );
    
    event LiquidityRemoved(
        address indexed provider,
        uint256 wethAmount,
        uint256 usdcAmount,
        uint256 lpTokensBurned
    );
    
    /// @notice Emitted when reserves change significantly in one block
    event ReserveAnomaly(
        uint256 indexed blockNumber,
        uint256 wethBefore,
        uint256 wethAfter,
        uint256 usdcBefore,
        uint256 usdcAfter,
        uint256 percentageChange
    );
    
    /// @notice Emitted on pause/unpause
    event EmergencyPaused(address indexed by, uint256 timestamp);
    event EmergencyUnpaused(address indexed by, uint256 timestamp);
    
    // ==========================================================================
    // STATE VARIABLES
    // ==========================================================================
    
    /// @notice WETH token contract
    IERC20 public immutable weth;
    
    /// @notice USDC token contract
    IERC20 public immutable usdc;
    
    /// @notice Current reserves
    uint256 public wethReserve;
    uint256 public usdcReserve;
    
    /// @notice LP token tracking (simplified - not ERC20)
    mapping(address => uint256) public lpBalances;
    uint256 public totalLpSupply;
    
    /// @notice Swap fee (0.3% = 30 basis points)
    uint256 public constant SWAP_FEE_BPS = 30;
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    /// @notice Emergency pause state
    bool public paused;
    
    /// @notice Security agent that can pause
    address public securityAgent;
    
    /// @notice Block-level tracking for manipulation detection
    struct BlockSnapshot {
        uint256 wethReserve;
        uint256 usdcReserve;
        uint256 swapCount;
        uint256 totalVolumeWeth;
        bool exists;
    }
    
    mapping(uint256 => BlockSnapshot) public blockSnapshots;
    uint256 public lastSnapshotBlock;
    
    /// @notice Same-block swap counter (flash loan indicator)
    uint256 public swapsThisBlock;
    uint256 private lastSwapBlock;
    
    // ==========================================================================
    // CONSTRUCTOR
    // ==========================================================================
    
    /**
     * @param _weth WETH token address
     * @param _usdc USDC token address
     */
    constructor(address _weth, address _usdc) Ownable(msg.sender) {
        require(_weth != address(0) && _usdc != address(0), "Invalid token addresses");
        weth = IERC20(_weth);
        usdc = IERC20(_usdc);
    }
    
    // ==========================================================================
    // MODIFIERS
    // ==========================================================================
    
    modifier whenNotPaused() {
        require(!paused, "AMM is paused");
        _;
    }
    
    modifier onlySecurityAgent() {
        require(
            msg.sender == securityAgent || msg.sender == owner(),
            "Only security agent or owner"
        );
        _;
    }
    
    // ==========================================================================
    // LIQUIDITY FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Add liquidity to the pool
     * @param wethAmount Amount of WETH to add
     * @param usdcAmount Amount of USDC to add
     * @return lpTokens Amount of LP tokens minted
     * 
     * SECURITY NOTE: No slippage protection for simplicity.
     * Production AMMs should include minLpTokens parameter.
     */
    function addLiquidity(
        uint256 wethAmount,
        uint256 usdcAmount
    ) external nonReentrant whenNotPaused returns (uint256 lpTokens) {
        require(wethAmount > 0 && usdcAmount > 0, "Amounts must be positive");
        
        // Transfer tokens to pool
        weth.safeTransferFrom(msg.sender, address(this), wethAmount);
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        
        // Calculate LP tokens
        if (totalLpSupply == 0) {
            // Initial liquidity - use geometric mean
            lpTokens = sqrt(wethAmount * usdcAmount);
        } else {
            // Proportional to existing reserves
            uint256 lpFromWeth = (wethAmount * totalLpSupply) / wethReserve;
            uint256 lpFromUsdc = (usdcAmount * totalLpSupply) / usdcReserve;
            lpTokens = lpFromWeth < lpFromUsdc ? lpFromWeth : lpFromUsdc;
        }
        
        require(lpTokens > 0, "Insufficient LP tokens");
        
        // Update state
        wethReserve += wethAmount;
        usdcReserve += usdcAmount;
        lpBalances[msg.sender] += lpTokens;
        totalLpSupply += lpTokens;
        
        _updateBlockSnapshot();
        
        emit LiquidityAdded(msg.sender, wethAmount, usdcAmount, lpTokens);
    }
    
    /**
     * @notice Remove liquidity from the pool
     * @param lpTokens Amount of LP tokens to burn
     * @return wethAmount WETH returned
     * @return usdcAmount USDC returned
     */
    function removeLiquidity(
        uint256 lpTokens
    ) external nonReentrant returns (uint256 wethAmount, uint256 usdcAmount) {
        require(lpTokens > 0, "Must burn positive LP tokens");
        require(lpBalances[msg.sender] >= lpTokens, "Insufficient LP balance");
        
        // Calculate token amounts
        wethAmount = (lpTokens * wethReserve) / totalLpSupply;
        usdcAmount = (lpTokens * usdcReserve) / totalLpSupply;
        
        // Update state
        lpBalances[msg.sender] -= lpTokens;
        totalLpSupply -= lpTokens;
        wethReserve -= wethAmount;
        usdcReserve -= usdcAmount;
        
        // Transfer tokens
        weth.safeTransfer(msg.sender, wethAmount);
        usdc.safeTransfer(msg.sender, usdcAmount);
        
        emit LiquidityRemoved(msg.sender, wethAmount, usdcAmount, lpTokens);
    }
    
    // ==========================================================================
    // SWAP FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Swap WETH for USDC
     * @param wethIn Amount of WETH to swap
     * @return usdcOut Amount of USDC received
     * 
     * VULNERABILITY: No slippage protection, MEV-exploitable
     * This is intentional for attack simulation.
     */
    function swapWethForUsdc(
        uint256 wethIn
    ) external nonReentrant whenNotPaused returns (uint256 usdcOut) {
        require(wethIn > 0, "Input must be positive");
        require(wethReserve > 0 && usdcReserve > 0, "No liquidity");
        
        // Apply swap fee
        uint256 wethInAfterFee = (wethIn * (BPS_DENOMINATOR - SWAP_FEE_BPS)) / BPS_DENOMINATOR;
        
        // Constant product formula: x * y = k
        // New y = k / (x + dx) 
        // dy = y - new_y
        uint256 k = wethReserve * usdcReserve;
        uint256 newWethReserve = wethReserve + wethInAfterFee;
        uint256 newUsdcReserve = k / newWethReserve;
        usdcOut = usdcReserve - newUsdcReserve;
        
        require(usdcOut > 0, "Insufficient output");
        require(usdcOut < usdcReserve, "Output exceeds reserves");
        
        // Transfer tokens
        weth.safeTransferFrom(msg.sender, address(this), wethIn);
        usdc.safeTransfer(msg.sender, usdcOut);
        
        // Calculate effective price for monitoring
        // Price = USDC out / WETH in (6 decimals / 18 decimals adjustment)
        uint256 effectivePrice = (usdcOut * 1e18) / wethIn;
        
        // Update reserves
        wethReserve = newWethReserve + (wethIn - wethInAfterFee); // Include fee
        usdcReserve = newUsdcReserve;
        
        // Track same-block activity
        _trackSwap(wethIn);
        
        emit Swap(
            msg.sender,
            wethIn,
            usdcOut,
            true,
            wethReserve,
            usdcReserve,
            effectivePrice,
            block.number
        );
    }
    
    /**
     * @notice Swap USDC for WETH
     * @param usdcIn Amount of USDC to swap
     * @return wethOut Amount of WETH received
     */
    function swapUsdcForWeth(
        uint256 usdcIn
    ) external nonReentrant whenNotPaused returns (uint256 wethOut) {
        require(usdcIn > 0, "Input must be positive");
        require(wethReserve > 0 && usdcReserve > 0, "No liquidity");
        
        // Apply swap fee
        uint256 usdcInAfterFee = (usdcIn * (BPS_DENOMINATOR - SWAP_FEE_BPS)) / BPS_DENOMINATOR;
        
        // Constant product formula
        uint256 k = wethReserve * usdcReserve;
        uint256 newUsdcReserve = usdcReserve + usdcInAfterFee;
        uint256 newWethReserve = k / newUsdcReserve;
        wethOut = wethReserve - newWethReserve;
        
        require(wethOut > 0, "Insufficient output");
        require(wethOut < wethReserve, "Output exceeds reserves");
        
        // Transfer tokens
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        weth.safeTransfer(msg.sender, wethOut);
        
        // Calculate effective price
        uint256 effectivePrice = (usdcIn * 1e18) / wethOut;
        
        // Update reserves
        usdcReserve = newUsdcReserve + (usdcIn - usdcInAfterFee);
        wethReserve = newWethReserve;
        
        _trackSwap((wethOut * usdcIn) / wethReserve); // Normalize to WETH equivalent
        
        emit Swap(
            msg.sender,
            usdcIn,
            wethOut,
            false,
            wethReserve,
            usdcReserve,
            effectivePrice,
            block.number
        );
    }
    
    // ==========================================================================
    // PRICE QUERY FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Get current spot price (USDC per WETH)
     * @return price Price with 8 decimals (Chainlink-compatible)
     * 
     * SECURITY NOTE: Spot price is manipulatable. 
     * Real protocols should use TWAP or external oracles.
     */
    function getSpotPrice() external view returns (uint256 price) {
        if (wethReserve == 0) return 0;
        // USDC has 6 decimals, WETH has 18
        // We want 8 decimals output
        // price = (usdcReserve / wethReserve) * 10^(18-6+8) = * 10^20
        return (usdcReserve * 1e20) / wethReserve;
    }
    
    /**
     * @notice Get reserves and derived price
     * @return _wethReserve Current WETH reserve
     * @return _usdcReserve Current USDC reserve
     * @return spotPrice Current spot price (8 decimals)
     */
    function getReserves() external view returns (
        uint256 _wethReserve,
        uint256 _usdcReserve,
        uint256 spotPrice
    ) {
        _wethReserve = wethReserve;
        _usdcReserve = usdcReserve;
        if (wethReserve > 0) {
            spotPrice = (usdcReserve * 1e20) / wethReserve;
        }
    }
    
    /**
     * @notice Get quote for a potential swap
     * @param amountIn Input amount
     * @param isWethToUsdc Direction of swap
     * @return amountOut Expected output
     */
    function getQuote(
        uint256 amountIn,
        bool isWethToUsdc
    ) external view returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        
        uint256 amountInAfterFee = (amountIn * (BPS_DENOMINATOR - SWAP_FEE_BPS)) / BPS_DENOMINATOR;
        uint256 k = wethReserve * usdcReserve;
        
        if (isWethToUsdc) {
            uint256 newWethReserve = wethReserve + amountInAfterFee;
            uint256 newUsdcReserve = k / newWethReserve;
            amountOut = usdcReserve - newUsdcReserve;
        } else {
            uint256 newUsdcReserve = usdcReserve + amountInAfterFee;
            uint256 newWethReserve = k / newUsdcReserve;
            amountOut = wethReserve - newWethReserve;
        }
    }
    
    // ==========================================================================
    // SECURITY FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Set security agent address
     * @param _agent Agent address that can pause
     */
    function setSecurityAgent(address _agent) external onlyOwner {
        securityAgent = _agent;
    }
    
    /**
     * @notice Emergency pause - stops all swaps and liquidity changes
     * @dev Called by security agent when attack detected
     */
    function pause() external onlySecurityAgent {
        require(!paused, "Already paused");
        paused = true;
        emit EmergencyPaused(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Resume operations after security review
     */
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit EmergencyUnpaused(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Get same-block swap statistics
     * @return count Number of swaps in current block
     * @return blockNumber Current block number
     */
    function getBlockSwapStats() external view returns (
        uint256 count,
        uint256 blockNumber
    ) {
        if (block.number == lastSwapBlock) {
            return (swapsThisBlock, block.number);
        }
        return (0, block.number);
    }
    
    // ==========================================================================
    // INTERNAL FUNCTIONS
    // ==========================================================================
    
    function _trackSwap(uint256 wethVolume) internal {
        // Update same-block counter
        if (block.number == lastSwapBlock) {
            swapsThisBlock++;
        } else {
            lastSwapBlock = block.number;
            swapsThisBlock = 1;
        }
        
        // Update block snapshot
        BlockSnapshot storage snapshot = blockSnapshots[block.number];
        
        if (!snapshot.exists) {
            // First swap in this block - record starting reserves
            snapshot.wethReserve = wethReserve;
            snapshot.usdcReserve = usdcReserve;
            snapshot.exists = true;
        }
        
        snapshot.swapCount++;
        snapshot.totalVolumeWeth += wethVolume;
    }
    
    function _updateBlockSnapshot() internal {
        if (block.number > lastSnapshotBlock) {
            blockSnapshots[block.number] = BlockSnapshot({
                wethReserve: wethReserve,
                usdcReserve: usdcReserve,
                swapCount: 0,
                totalVolumeWeth: 0,
                exists: true
            });
            lastSnapshotBlock = block.number;
        }
    }
    
    /**
     * @notice Integer square root (Babylonian method)
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
