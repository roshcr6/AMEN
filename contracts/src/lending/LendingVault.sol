// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../oracle/PriceOracle.sol";

/**
 * @title LendingVault
 * @notice Over-collateralized lending protocol vulnerable to oracle manipulation
 * @dev Core protocol being protected by the AMEN security agent
 * 
 * SECURITY ARCHITECTURE:
 * - Health factor based liquidations
 * - Oracle-dependent pricing (vulnerability vector)
 * - Emergency pause capability
 * - Liquidation blocking during attacks
 * - Detailed event emission for monitoring
 * 
 * THREAT MODEL:
 * 1. Attacker manipulates oracle price downward
 * 2. Victim's health factor drops below liquidation threshold
 * 3. Attacker liquidates victim's position at distorted price
 * 4. Attacker returns oracle to normal, profits from liquidation bonus
 * 
 * PROTECTION:
 * - Agent monitors for price manipulation
 * - Agent can pause() entire protocol
 * - Agent can blockLiquidations() during attacks
 */
contract LendingVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    // ==========================================================================
    // EVENTS - Critical for agent monitoring
    // ==========================================================================
    
    /// @notice Emitted when collateral is deposited
    event CollateralDeposited(
        address indexed user,
        uint256 amount,
        uint256 newBalance,
        uint256 healthFactor
    );
    
    /// @notice Emitted when collateral is withdrawn
    event CollateralWithdrawn(
        address indexed user,
        uint256 amount,
        uint256 newBalance,
        uint256 healthFactor
    );
    
    /// @notice Emitted when loan is taken
    event LoanTaken(
        address indexed user,
        uint256 amount,
        uint256 totalDebt,
        uint256 healthFactor
    );
    
    /// @notice Emitted when loan is repaid
    event LoanRepaid(
        address indexed user,
        uint256 amount,
        uint256 remainingDebt,
        uint256 healthFactor
    );
    
    /// @notice Emitted on liquidation - PRIMARY ATTACK INDICATOR
    event Liquidation(
        address indexed liquidator,
        address indexed user,
        uint256 debtRepaid,
        uint256 collateralSeized,
        uint256 oraclePrice,
        uint256 blockNumber,
        uint256 timestamp
    );
    
    /// @notice Emitted when liquidation is BLOCKED by security agent
    event LiquidationBlocked(
        address indexed attemptedLiquidator,
        address indexed targetUser,
        string reason,
        uint256 timestamp
    );
    
    /// @notice Emitted on emergency actions
    event EmergencyPaused(address indexed by, uint256 timestamp, string reason);
    event EmergencyUnpaused(address indexed by, uint256 timestamp);
    event LiquidationsBlocked(address indexed by, uint256 timestamp);
    event LiquidationsUnblocked(address indexed by, uint256 timestamp);
    
    /// @notice Emitted when health factor drops dangerously
    event HealthFactorAlert(
        address indexed user,
        uint256 healthFactor,
        uint256 oraclePrice,
        uint256 timestamp
    );
    
    // ==========================================================================
    // STATE VARIABLES
    // ==========================================================================
    
    /// @notice WETH token (collateral asset)
    IERC20 public immutable collateralToken;
    
    /// @notice USDC token (loan asset)
    IERC20 public immutable loanToken;
    
    /// @notice Price oracle for ETH/USD
    PriceOracle public oracle;
    
    /// @notice User collateral balances (in WETH)
    mapping(address => uint256) public collateralBalances;
    
    /// @notice User loan balances (in USDC)
    mapping(address => uint256) public loanBalances;
    
    /// @notice Total collateral deposited
    uint256 public totalCollateral;
    
    /// @notice Total loans outstanding
    uint256 public totalLoans;
    
    // ==========================================================================
    // PROTOCOL PARAMETERS
    // ==========================================================================
    
    /**
     * @notice Collateralization ratio required (150% = 15000 basis points)
     * @dev User must have 1.5x collateral value vs loan value
     */
    uint256 public constant COLLATERAL_RATIO_BPS = 15000;
    
    /**
     * @notice Liquidation threshold (120% = 12000 basis points)  
     * @dev Below this health factor, position can be liquidated
     */
    uint256 public constant LIQUIDATION_THRESHOLD_BPS = 12000;
    
    /**
     * @notice Liquidation bonus for liquidators (5% = 500 basis points)
     * @dev Incentive for liquidators to maintain protocol health
     */
    uint256 public constant LIQUIDATION_BONUS_BPS = 500;
    
    /**
     * @notice Maximum loan-to-value ratio (66% = 6666 basis points)
     */
    uint256 public constant MAX_LTV_BPS = 6666;
    
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // ==========================================================================
    // SECURITY STATE
    // ==========================================================================
    
    /// @notice Emergency pause flag - stops all operations
    bool public paused;
    
    /// @notice Liquidation block flag - stops only liquidations
    bool public liquidationsBlocked;
    
    /// @notice Security agent address
    address public securityAgent;
    
    /// @notice Time of last liquidation (for clustering detection)
    uint256 public lastLiquidationTime;
    uint256 public liquidationsThisBlock;
    uint256 private lastLiquidationBlock;
    
    // ==========================================================================
    // CONSTRUCTOR
    // ==========================================================================
    
    /**
     * @param _collateralToken WETH address
     * @param _loanToken USDC address
     * @param _oracle Price oracle address
     */
    constructor(
        address _collateralToken,
        address _loanToken,
        address _oracle
    ) Ownable(msg.sender) {
        require(_collateralToken != address(0), "Invalid collateral token");
        require(_loanToken != address(0), "Invalid loan token");
        require(_oracle != address(0), "Invalid oracle");
        
        collateralToken = IERC20(_collateralToken);
        loanToken = IERC20(_loanToken);
        oracle = PriceOracle(_oracle);
    }
    
    // ==========================================================================
    // MODIFIERS
    // ==========================================================================
    
    modifier whenNotPaused() {
        require(!paused, "Protocol is paused");
        _;
    }
    
    modifier whenLiquidationsAllowed() {
        require(!liquidationsBlocked, "Liquidations are blocked");
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
    // USER FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Deposit WETH as collateral
     * @param amount Amount of WETH to deposit
     */
    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be positive");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        
        collateralBalances[msg.sender] += amount;
        totalCollateral += amount;
        
        uint256 healthFactor = getHealthFactor(msg.sender);
        
        emit CollateralDeposited(
            msg.sender,
            amount,
            collateralBalances[msg.sender],
            healthFactor
        );
    }
    
    /**
     * @notice Withdraw collateral
     * @param amount Amount of WETH to withdraw
     */
    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be positive");
        require(collateralBalances[msg.sender] >= amount, "Insufficient collateral");
        
        // Calculate new health factor after withdrawal
        uint256 newCollateral = collateralBalances[msg.sender] - amount;
        uint256 newHealthFactor = _calculateHealthFactor(
            newCollateral,
            loanBalances[msg.sender]
        );
        
        require(
            loanBalances[msg.sender] == 0 || newHealthFactor >= COLLATERAL_RATIO_BPS,
            "Withdrawal would undercollateralize position"
        );
        
        collateralBalances[msg.sender] = newCollateral;
        totalCollateral -= amount;
        
        collateralToken.safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(
            msg.sender,
            amount,
            newCollateral,
            newHealthFactor
        );
    }
    
    /**
     * @notice Borrow USDC against collateral
     * @param amount Amount of USDC to borrow
     */
    function borrow(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be positive");
        require(
            loanToken.balanceOf(address(this)) >= amount,
            "Insufficient liquidity"
        );
        
        // Calculate new health factor
        uint256 newDebt = loanBalances[msg.sender] + amount;
        uint256 healthFactor = _calculateHealthFactor(
            collateralBalances[msg.sender],
            newDebt
        );
        
        require(
            healthFactor >= COLLATERAL_RATIO_BPS,
            "Insufficient collateral for loan"
        );
        
        loanBalances[msg.sender] = newDebt;
        totalLoans += amount;
        
        loanToken.safeTransfer(msg.sender, amount);
        
        emit LoanTaken(msg.sender, amount, newDebt, healthFactor);
    }
    
    /**
     * @notice Repay borrowed USDC
     * @param amount Amount of USDC to repay
     */
    function repay(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be positive");
        require(loanBalances[msg.sender] > 0, "No outstanding loan");
        
        uint256 actualRepay = amount > loanBalances[msg.sender] 
            ? loanBalances[msg.sender] 
            : amount;
        
        loanToken.safeTransferFrom(msg.sender, address(this), actualRepay);
        
        loanBalances[msg.sender] -= actualRepay;
        totalLoans -= actualRepay;
        
        emit LoanRepaid(
            msg.sender,
            actualRepay,
            loanBalances[msg.sender],
            getHealthFactor(msg.sender)
        );
    }
    
    // ==========================================================================
    // LIQUIDATION FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Liquidate an undercollateralized position
     * @param user Address of the user to liquidate
     * @param repayAmount Amount of debt to repay
     * 
     * VULNERABILITY: This function uses oracle price which can be manipulated
     * PROTECTION: Security agent can block liquidations during attacks
     */
    function liquidate(
        address user,
        uint256 repayAmount
    ) external nonReentrant whenNotPaused whenLiquidationsAllowed {
        require(user != address(0), "Invalid user address");
        require(repayAmount > 0, "Repay amount must be positive");
        require(loanBalances[user] > 0, "User has no debt");
        
        // Get current oracle price
        (uint256 oraclePrice, , ) = oracle.getPrice();
        
        // Check if position is liquidatable
        uint256 healthFactor = getHealthFactor(user);
        require(
            healthFactor < LIQUIDATION_THRESHOLD_BPS,
            "Position is healthy - cannot liquidate"
        );
        
        // Track liquidation clustering (attack indicator)
        if (block.number == lastLiquidationBlock) {
            liquidationsThisBlock++;
        } else {
            lastLiquidationBlock = block.number;
            liquidationsThisBlock = 1;
        }
        lastLiquidationTime = block.timestamp;
        
        // Cap repay amount to user's debt
        uint256 actualRepay = repayAmount > loanBalances[user] 
            ? loanBalances[user] 
            : repayAmount;
        
        // Calculate collateral to seize (including bonus)
        // collateralValue = repayAmount * (10000 + bonus) / 10000
        // collateralAmount = collateralValue / price
        uint256 collateralToSeize = _calculateCollateralToSeize(
            actualRepay,
            oraclePrice
        );
        
        require(
            collateralToSeize <= collateralBalances[user],
            "Insufficient collateral to seize"
        );
        
        // Execute liquidation
        loanToken.safeTransferFrom(msg.sender, address(this), actualRepay);
        
        loanBalances[user] -= actualRepay;
        collateralBalances[user] -= collateralToSeize;
        totalLoans -= actualRepay;
        totalCollateral -= collateralToSeize;
        
        collateralToken.safeTransfer(msg.sender, collateralToSeize);
        
        emit Liquidation(
            msg.sender,
            user,
            actualRepay,
            collateralToSeize,
            oraclePrice,
            block.number,
            block.timestamp
        );
    }
    
    // ==========================================================================
    // VIEW FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Get user's current health factor
     * @param user User address
     * @return healthFactor Health factor in basis points (10000 = 100%)
     * 
     * Health Factor = (Collateral Value * 10000) / Debt Value
     * - > 15000 (150%): Fully healthy
     * - < 12000 (120%): Liquidatable
     */
    function getHealthFactor(address user) public view returns (uint256 healthFactor) {
        return _calculateHealthFactor(
            collateralBalances[user],
            loanBalances[user]
        );
    }
    
    /**
     * @notice Get user's position details
     * @param user User address
     * @return collateral Collateral balance (WETH)
     * @return debt Loan balance (USDC)
     * @return healthFactor Current health factor
     * @return collateralValueUsd Collateral value in USD (6 decimals)
     * @return maxBorrow Maximum additional borrow amount
     */
    function getPosition(address user) external view returns (
        uint256 collateral,
        uint256 debt,
        uint256 healthFactor,
        uint256 collateralValueUsd,
        uint256 maxBorrow
    ) {
        collateral = collateralBalances[user];
        debt = loanBalances[user];
        healthFactor = getHealthFactor(user);
        
        (uint256 oraclePrice, , ) = oracle.getPrice();
        // collateralValueUsd in USDC decimals (6)
        // collateral is 18 decimals, oracle is 8 decimals
        // result should be 6 decimals
        collateralValueUsd = (collateral * oraclePrice) / 1e20;
        
        // Max borrow = (collateral value * MAX_LTV / 10000) - current debt
        uint256 maxBorrowValue = (collateralValueUsd * MAX_LTV_BPS) / BPS_DENOMINATOR;
        maxBorrow = maxBorrowValue > debt ? maxBorrowValue - debt : 0;
    }
    
    /**
     * @notice Check if a position is liquidatable
     * @param user User address
     * @return isLiquidatable_ True if position can be liquidated
     * @return healthFactor Current health factor
     */
    function isLiquidatable(address user) external view returns (
        bool isLiquidatable_,
        uint256 healthFactor
    ) {
        healthFactor = getHealthFactor(user);
        isLiquidatable_ = healthFactor < LIQUIDATION_THRESHOLD_BPS && loanBalances[user] > 0;
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
     * @notice Update oracle address
     * @param _oracle New oracle address
     */
    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        oracle = PriceOracle(_oracle);
    }
    
    /**
     * @notice Emergency pause - stops ALL operations
     * @param reason Reason for pause (for logging)
     * @dev Called by security agent when severe attack detected
     */
    function pause(string calldata reason) external onlySecurityAgent {
        require(!paused, "Already paused");
        paused = true;
        emit EmergencyPaused(msg.sender, block.timestamp, reason);
    }
    
    /**
     * @notice Resume all operations
     */
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit EmergencyUnpaused(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Block liquidations only (less severe than full pause)
     * @dev Called when oracle manipulation detected but protocol otherwise functional
     */
    function blockLiquidations() external onlySecurityAgent {
        require(!liquidationsBlocked, "Liquidations already blocked");
        liquidationsBlocked = true;
        emit LiquidationsBlocked(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Unblock liquidations
     */
    function unblockLiquidations() external onlyOwner {
        require(liquidationsBlocked, "Liquidations not blocked");
        liquidationsBlocked = false;
        emit LiquidationsUnblocked(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Add USDC liquidity for lending
     * @param amount Amount of USDC to add
     */
    function addLiquidity(uint256 amount) external onlyOwner {
        loanToken.safeTransferFrom(msg.sender, address(this), amount);
    }
    
    // ==========================================================================
    // INTERNAL FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Calculate health factor for given collateral and debt
     * @param collateral Collateral amount (WETH, 18 decimals)
     * @param debt Debt amount (USDC, 6 decimals)
     * @return healthFactor Health factor in basis points
     */
    function _calculateHealthFactor(
        uint256 collateral,
        uint256 debt
    ) internal view returns (uint256 healthFactor) {
        if (debt == 0) return type(uint256).max;
        if (collateral == 0) return 0;
        
        (uint256 oraclePrice, , ) = oracle.getPrice();
        
        // collateralValue in USDC terms (6 decimals)
        // collateral (18 dec) * price (8 dec) / 10^20 = 6 decimals
        uint256 collateralValueUsd = (collateral * oraclePrice) / 1e20;
        
        // healthFactor = collateralValue * 10000 / debt
        healthFactor = (collateralValueUsd * BPS_DENOMINATOR) / debt;
    }
    
    /**
     * @notice Calculate collateral to seize in liquidation
     * @param repayAmount Amount of debt being repaid (USDC, 6 decimals)
     * @param oraclePrice Current oracle price (8 decimals)
     * @return collateralAmount Collateral to seize (WETH, 18 decimals)
     */
    function _calculateCollateralToSeize(
        uint256 repayAmount,
        uint256 oraclePrice
    ) internal pure returns (uint256 collateralAmount) {
        // Add liquidation bonus
        uint256 repayWithBonus = (repayAmount * (BPS_DENOMINATOR + LIQUIDATION_BONUS_BPS)) / BPS_DENOMINATOR;
        
        // Convert USDC to WETH
        // repayWithBonus (6 dec) * 10^20 / price (8 dec) = 18 decimals
        collateralAmount = (repayWithBonus * 1e20) / oraclePrice;
    }
}
