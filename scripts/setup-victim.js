/**
 * AMEN - Victim Position Setup
 * 
 * Creates a victim position in the lending vault:
 * 1. Mint WETH to victim
 * 2. Deposit WETH as collateral
 * 3. Borrow USDC against collateral
 * 
 * This creates a position that becomes liquidatable when oracle is manipulated.
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const WETH_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function mint(address to, uint256 amount)"
];

const VAULT_ABI = [
    "function depositCollateral(uint256 amount)",
    "function borrow(uint256 amount)",
    "function getPosition(address user) view returns (uint256, uint256, uint256, uint256, uint256)",
    "function getHealthFactor(address user) view returns (uint256)"
];

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           AMEN - Victim Position Setup                         ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Load deployment
    const deploymentPath = path.join(__dirname, '..', 'contracts', 'deployments', 'sepolia-deployment.json');
    if (!fs.existsSync(deploymentPath)) {
        console.error('❌ Deployment file not found. Run contract deployment first.');
        process.exit(1);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

    // Setup provider and victim wallet
    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    
    // Use deployer as owner (to mint tokens) and create new victim
    const ownerKey = process.env.DEPLOYER_PRIVATE_KEY;
    const victimKey = process.env.VICTIM_PRIVATE_KEY || process.env.ATTACKER_PRIVATE_KEY; // Can use same key for testing
    
    if (!ownerKey) {
        console.error('❌ DEPLOYER_PRIVATE_KEY not set');
        process.exit(1);
    }

    const owner = new ethers.Wallet(ownerKey, provider);
    const victim = victimKey ? new ethers.Wallet(victimKey, provider) : owner;

    console.log('👤 Owner address:', owner.address);
    console.log('🎯 Victim address:', victim.address);
    console.log('');

    // Setup contracts
    const wethAsOwner = new ethers.Contract(deployment.contracts.WETH, WETH_ABI, owner);
    const wethAsVictim = new ethers.Contract(deployment.contracts.WETH, WETH_ABI, victim);
    const vaultAsVictim = new ethers.Contract(deployment.contracts.LENDING_VAULT, VAULT_ABI, victim);

    // Step 1: Mint WETH to victim
    console.log('💰 Step 1: Minting WETH to victim...');
    const mintAmount = ethers.parseEther("10"); // 10 WETH
    let tx = await wethAsOwner.mint(victim.address, mintAmount);
    await tx.wait();
    console.log('   ✅ Minted 10 WETH to victim');

    // Step 2: Approve and deposit collateral
    console.log('🏦 Step 2: Depositing collateral...');
    const collateralAmount = ethers.parseEther("5"); // 5 WETH
    
    tx = await wethAsVictim.approve(deployment.contracts.LENDING_VAULT, collateralAmount);
    await tx.wait();
    
    tx = await vaultAsVictim.depositCollateral(collateralAmount);
    await tx.wait();
    console.log('   ✅ Deposited 5 WETH as collateral');

    // Step 3: Borrow USDC
    console.log('💵 Step 3: Borrowing USDC...');
    // At $2000/ETH, 5 WETH = $10,000 collateral
    // Max borrow at 66% LTV = $6,666
    // Borrow $5,000 to have some buffer (but vulnerable to 40% price drop)
    const borrowAmount = ethers.parseUnits("5000", 6); // 5000 USDC
    
    tx = await vaultAsVictim.borrow(borrowAmount);
    await tx.wait();
    console.log('   ✅ Borrowed 5,000 USDC');

    // Check final position
    const [collateral, debt, healthFactor, collateralUsd, maxBorrow] = 
        await vaultAsVictim.getPosition(victim.address);

    console.log('\n📊 Final Position:');
    console.log('   Collateral:', ethers.formatEther(collateral), 'WETH');
    console.log('   Debt:', ethers.formatUnits(debt, 6), 'USDC');
    console.log('   Health Factor:', Number(healthFactor) / 100, '%');
    console.log('   Collateral Value:', ethers.formatUnits(collateralUsd, 6), 'USD');

    // Analysis
    console.log('\n📈 Liquidation Analysis:');
    console.log('   Current price: $2000/ETH');
    console.log('   Health Factor: ' + (Number(healthFactor) / 100) + '%');
    console.log('   Liquidation threshold: 120%');
    
    // Calculate what price would make this liquidatable
    // HF = (collateral * price) / debt * 100
    // For HF < 120%, price < (debt * 120) / (collateral * 100)
    const debtNum = Number(ethers.formatUnits(debt, 6));
    const collateralNum = Number(ethers.formatEther(collateral));
    const liquidationPrice = (debtNum * 120) / (collateralNum * 100);
    
    console.log('   Liquidatable below: $' + liquidationPrice.toFixed(2) + '/ETH');
    console.log('   A 40% price drop to $1200 would trigger liquidation');

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    ✅ Victim Setup Complete                    ');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('Victim address:', victim.address);
    console.log('\nTo run attack simulation:');
    console.log(`  node attack-simulation.js ${victim.address}`);
}

main().catch(console.error);
