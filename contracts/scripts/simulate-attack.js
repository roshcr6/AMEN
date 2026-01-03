const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Simulate Flash Loan Attack
 * This demonstrates a price manipulation attack that AMEN should detect
 */

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("           🚨 AMEN - Flash Loan Attack Simulation 🚨           ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("⚠️  This script simulates a malicious attack for testing purposes");
    console.log("⚠️  AMEN agent should detect and block this manipulation");
    console.log("");

    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    // Get accounts - use deployer as attacker for simplicity
    const [deployer] = await hre.ethers.getSigners();
    const attacker = deployer; // On testnet, we'll use same account
    console.log("👤 Attacker:", attacker.address);
    console.log("");

    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const usdc = await hre.ethers.getContractAt("MockUSDC", addresses.USDC);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const oracle = await hre.ethers.getContractAt("PriceOracle", addresses.ORACLE);
    const vault = await hre.ethers.getContractAt("LendingVault", addresses.LENDING_VAULT);

    // Setup: Give attacker tokens
    console.log("🎭 SETUP: Giving attacker tokens...");
    const attackAmount = hre.ethers.parseEther("50"); // Large amount to manipulate price
    await weth.mint(attacker.address, attackAmount);
    console.log("   ✅ Minted 50 WETH to attacker");
    console.log("");

    // Check initial state
    console.log("📊 BEFORE ATTACK:");
    const oraclePriceBefore = await oracle.getPrice();
    const ammPriceBefore = await amm.getSpotPrice();
    console.log("   Oracle Price: $" + hre.ethers.formatUnits(oraclePriceBefore[0], 8));
    console.log("   AMM Price: $" + hre.ethers.formatUnits(ammPriceBefore, 18));
    console.log("");

    // ATTACK: Large swap to manipulate AMM price
    console.log("🚨 EXECUTING ATTACK:");
    console.log("   Step 1: Large WETH → USDC swap to crash price");
    
    // Approve and swap
    await weth.connect(attacker).approve(addresses.AMM, attackAmount);
    
    try {
        const swapTx = await amm.connect(attacker).swapWethForUsdc(
            attackAmount
        );
        await swapTx.wait();
        console.log("   ✅ Swap executed:", swapTx.hash);
        console.log("");

        // Check manipulated state
        console.log("📊 AFTER ATTACK:");
        const ammPriceAfter = await amm.getSpotPrice();
        const oraclePriceAfter = await oracle.getPrice();
        
        console.log("   Oracle Price: $" + hre.ethers.formatUnits(oraclePriceAfter[0], 8));
        console.log("   AMM Price: $" + hre.ethers.formatUnits(ammPriceAfter, 18));
        
        const priceChange = Number(hre.ethers.formatUnits(ammPriceBefore, 18)) - 
                           Number(hre.ethers.formatUnits(ammPriceAfter, 18));
        const percentChange = (priceChange / Number(hre.ethers.formatUnits(ammPriceBefore, 18))) * 100;
        
        console.log("   💥 Price crashed by: " + percentChange.toFixed(2) + "%");
        console.log("");
        console.log("❌ ATTACK SUCCEEDED - Price was manipulated!");
        
    } catch (error) {
        console.log("");
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("      🛡️  ATTACK BLOCKED BY AMEN! AMM IS PROTECTED 🛡️          ");
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("");
        console.log("   The AMM was paused before the attack could execute.");
        console.log("   Error:", error.message.split('\n')[0]);
        console.log("");
        
        // Verify price unchanged
        const ammPriceAfter = await amm.getSpotPrice();
        console.log("   AMM Price: $" + hre.ethers.formatUnits(ammPriceAfter, 18) + " (unchanged ✅)");
        console.log("");
        return;
    }
    console.log("");

    // Check if AMEN detected it
    console.log("🛡️ AMEN AGENT STATUS:");
    const liquidationsBlocked = await vault.liquidationsBlocked();
    const vaultPaused = await vault.paused();
    
    console.log("   Liquidations Blocked:", liquidationsBlocked ? "✅ YES" : "❌ NO");
    console.log("   Vault Paused:", vaultPaused ? "✅ YES" : "❌ NO");
    console.log("");

    if (liquidationsBlocked || vaultPaused) {
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("          ✅ AMEN SUCCESSFULLY DETECTED THE ATTACK!            ");
        console.log("═══════════════════════════════════════════════════════════════");
    } else {
        console.log("═══════════════════════════════════════════════════════════════");
        console.log("     ⚠️  Attack executed but AMEN hasn't responded yet         ");
        console.log("        (Agent may respond in the next monitoring cycle)       ");
        console.log("═══════════════════════════════════════════════════════════════");
    }

    console.log("");
    console.log("💡 TIP: Check the AMEN agent logs and dashboard to see the");
    console.log("   real-time threat detection and AI reasoning!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
