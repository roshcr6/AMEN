const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Pre-Attack: Manipulate price to trigger agent detection
 * Then wait for agent to pause, then attempt main attack
 */

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("🎯 ATTACK DEMONSTRATION WITH AGENT BLOCKING\n");
    console.log("This demo shows how the AMEN agent blocks attacks.\n");
    
    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [attacker] = await hre.ethers.getSigners();
    
    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const oracle = await hre.ethers.getContractAt("PriceOracle", addresses.ORACLE);
    const vault = await hre.ethers.getContractAt("LendingVault", addresses.LENDING_VAULT);

    // ========== PHASE 1: Check if protected ==========
    console.log("📋 PHASE 1: Checking Protocol Status");
    console.log("━".repeat(50));
    
    let ammPaused = await amm.paused();
    let vaultPaused = await vault.paused();
    let liqBlocked = await vault.liquidationsBlocked();
    
    console.log(`AMM Paused: ${ammPaused}`);
    console.log(`Vault Paused: ${vaultPaused}`);
    console.log(`Liquidations Blocked: ${liqBlocked}`);
    
    if (ammPaused) {
        console.log("\n🛡️ Protocol is already protected (AMM paused)");
        console.log("🛡️ The AI agent has detected a previous attack attempt!");
        console.log("\n✅ DEFENSE STATUS: ACTIVE");
        console.log("   - New swap attacks will be rejected");
        console.log("   - Liquidations at manipulated prices blocked");
        console.log("   - User funds are SAFE");
        return;
    }

    // ========== PHASE 2: Execute small probe swap ==========
    console.log("\n🔍 PHASE 2: Executing Probe Swap (triggers detection)");
    console.log("━".repeat(50));
    
    const probeAmount = hre.ethers.parseEther("10");
    
    // Get initial price
    const priceBefore = await amm.getSpotPrice();
    console.log(`Price Before: $${hre.ethers.formatUnits(priceBefore, 8)}`);
    
    // Mint and approve
    await (await weth.mint(attacker.address, probeAmount)).wait();
    await (await weth.approve(addresses.AMM, probeAmount)).wait();
    
    console.log("📤 Executing 10 WETH probe swap...");
    try {
        const tx = await amm.swapWethForUsdc(probeAmount);
        await tx.wait();
        console.log("✅ Probe swap completed");
        
        const priceAfter = await amm.getSpotPrice();
        const deviation = Math.abs(
            Number(hre.ethers.formatUnits(priceBefore, 8)) - 
            Number(hre.ethers.formatUnits(priceAfter, 8))
        ) / Number(hre.ethers.formatUnits(priceBefore, 8)) * 100;
        
        console.log(`Price After: $${hre.ethers.formatUnits(priceAfter, 8)}`);
        console.log(`Deviation: ${deviation.toFixed(2)}%`);
        
    } catch (error) {
        if (error.message.includes("paused")) {
            console.log("🛡️ Probe swap BLOCKED - AMM already paused!");
            return;
        }
        throw error;
    }

    // ========== PHASE 3: Wait and monitor agent response ==========
    console.log("\n⏳ PHASE 3: Waiting for Agent Detection (5 seconds)");
    console.log("━".repeat(50));
    console.log("The AMEN agent should detect the price deviation...");
    
    for (let i = 5; i > 0; i--) {
        process.stdout.write(`\r   Countdown: ${i}s `);
        await sleep(1000);
        
        // Check if paused during wait
        ammPaused = await amm.paused();
        if (ammPaused) {
            console.log(`\n\n🛡️ AGENT ACTIVATED! AMM paused after ${5-i+1} seconds!`);
            break;
        }
    }
    console.log();

    // ========== PHASE 4: Attempt main attack ==========
    console.log("\n💥 PHASE 4: Attempting Main Attack (50 WETH)");
    console.log("━".repeat(50));
    
    const attackAmount = hre.ethers.parseEther("50");
    await (await weth.mint(attacker.address, attackAmount)).wait();
    await (await weth.approve(addresses.AMM, attackAmount)).wait();
    
    ammPaused = await amm.paused();
    console.log(`AMM Paused Status: ${ammPaused}`);
    
    if (ammPaused) {
        console.log("\n🛡️🛡️🛡️ ATTACK PREVENTED! 🛡️🛡️🛡️");
        console.log("━".repeat(50));
        console.log("The AI agent detected the attack and paused the AMM!");
        console.log("The attacker cannot execute the main swap!");
        console.log("\n✅ DEFENSE SUCCESSFUL:");
        console.log("   • Price manipulation blocked");
        console.log("   • User positions protected");
        console.log("   • Attacker wasted gas on probe");
        return;
    }
    
    // Try the attack anyway
    console.log("📤 Sending attack transaction...");
    try {
        const tx = await amm.swapWethForUsdc(attackAmount, { gasLimit: 500000 });
        await tx.wait();
        
        // If we get here, attack succeeded (agent too slow)
        const priceAfterAttack = await amm.getSpotPrice();
        console.log("\n⚠️ Attack swap executed");
        console.log(`New Price: $${hre.ethers.formatUnits(priceAfterAttack, 8)}`);
        console.log("\n⚠️ Agent may still detect and pause for future protection");
        
    } catch (error) {
        if (error.message.includes("paused") || error.message.includes("AMM is paused")) {
            console.log("\n🛡️🛡️🛡️ ATTACK BLOCKED! 🛡️🛡️🛡️");
            console.log("━".repeat(50));
            console.log("The swap transaction was REJECTED!");
            console.log("Reason: AMM is paused");
            console.log("\n✅ DEFENSE SUCCESSFUL:");
            console.log("   • Large swap attack blocked");
            console.log("   • No price manipulation occurred");
            console.log("   • Attacker lost gas fees");
        } else {
            console.log("\n❌ Transaction failed:", error.message.split('\n')[0]);
        }
    }

    // ========== FINAL STATE ==========
    console.log("\n📊 FINAL STATE");
    console.log("━".repeat(50));
    const finalPrice = await amm.getSpotPrice();
    ammPaused = await amm.paused();
    vaultPaused = await vault.paused();
    liqBlocked = await vault.liquidationsBlocked();
    
    console.log(`AMM Price: $${hre.ethers.formatUnits(finalPrice, 8)}`);
    console.log(`AMM Paused: ${ammPaused}`);
    console.log(`Vault Paused: ${vaultPaused}`);
    console.log(`Liquidations Blocked: ${liqBlocked}`);
    
    if (ammPaused || vaultPaused || liqBlocked) {
        console.log("\n🛡️ PROTOCOL IS IN PROTECTED STATE");
        console.log("   The AMEN AI agent is actively defending!");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
