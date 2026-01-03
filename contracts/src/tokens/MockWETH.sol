// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockWETH
 * @notice Wrapped ETH mock for testing DeFi security scenarios
 * @dev Implements standard WETH deposit/withdraw pattern
 * 
 * SECURITY NOTE: This is a mock contract for testnet only.
 * In production, use canonical WETH deployment.
 */
contract MockWETH is ERC20, Ownable {
    // ==========================================================================
    // EVENTS
    // ==========================================================================
    
    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);
    
    // ==========================================================================
    // CONSTRUCTOR
    // ==========================================================================
    
    constructor() ERC20("Wrapped Ether", "WETH") Ownable(msg.sender) {
        // Initial supply for testing - 1000 WETH to deployer
        _mint(msg.sender, 1000 * 10**18);
    }
    
    // ==========================================================================
    // CORE FUNCTIONS
    // ==========================================================================
    
    /**
     * @notice Deposit ETH and receive WETH 1:1
     * @dev Standard WETH deposit pattern
     */
    function deposit() external payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }
    
    /**
     * @notice Withdraw ETH by burning WETH 1:1
     * @param amount Amount of WETH to burn
     */
    function withdraw(uint256 amount) external {
        require(balanceOf(msg.sender) >= amount, "Insufficient WETH balance");
        _burn(msg.sender, amount);
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
        
        emit Withdrawal(msg.sender, amount);
    }
    
    /**
     * @notice Mint tokens for testing purposes
     * @param to Recipient address
     * @param amount Amount to mint (in wei)
     * @dev Only owner can mint - used for test setup
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    /**
     * @notice Receive ETH and auto-wrap to WETH
     */
    receive() external payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }
}
