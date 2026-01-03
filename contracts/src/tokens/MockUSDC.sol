// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC stablecoin for testing DeFi security scenarios
 * @dev Uses 6 decimals like real USDC for realistic testing
 * 
 * SECURITY NOTE: This is a mock contract for testnet only.
 * In production, integrate with actual USDC.
 */
contract MockUSDC is ERC20, Ownable {
    // ==========================================================================
    // STATE VARIABLES
    // ==========================================================================
    
    /// @notice USDC uses 6 decimals (not 18)
    uint8 private constant DECIMALS = 6;
    
    // ==========================================================================
    // CONSTRUCTOR
    // ==========================================================================
    
    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {
        // Initial supply: 1,000,000 USDC to deployer
        _mint(msg.sender, 1_000_000 * 10**DECIMALS);
    }
    
    // ==========================================================================
    // OVERRIDES
    // ==========================================================================
    
    /**
     * @notice Returns 6 decimals like real USDC
     * @return Number of decimals (6)
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
    
    // ==========================================================================
    // MINTING (TESTNET ONLY)
    // ==========================================================================
    
    /**
     * @notice Mint tokens for testing purposes
     * @param to Recipient address
     * @param amount Amount to mint (6 decimal places)
     * @dev Only owner can mint - used for test setup
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    /**
     * @notice Faucet function for easy testnet distribution
     * @dev Anyone can claim 10,000 USDC once per address
     */
    mapping(address => bool) public hasClaimed;
    
    function faucet() external {
        require(!hasClaimed[msg.sender], "Already claimed from faucet");
        hasClaimed[msg.sender] = true;
        _mint(msg.sender, 10_000 * 10**DECIMALS);
    }
}
