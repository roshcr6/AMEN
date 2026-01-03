const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Attack Simulation with Defense Check
 * 
 * This script simulates a flash loan attack that:
 * 1. Announces the attack (triggers agent detection)
 * 2. Waits for agent to potentially pause
 * 3. Attempts the swap
 * 4. Reports if blocked or succeeded
 */

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("🚨🚨🚨 FLASH LOAN ATTACK SIMULATION 🚨🚨🚨\n");
    
    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    if (!fs.existsSync(deploymentPath)) {
        console.error("❌ Deployment file not found. Run deploy script first.");
        process.exit(1);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [attacker] = await hre.ethers.getSigners();
    console.log("👤 Attacker:", attacker.address);
    
    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const oracle = await hre.ethers.getContractAt("PriceOracle", addresses.ORACLE);
    const vault = await hre.ethers.getContractAt("LendingVault", addresses.LENDING_VAULT);

    // Step 1: Check initial state
    console.log("\n📊 STEP 1: Initial State Check");
    console.log("━".repeat(50));
    
    const oraclePrice = await oracle.getPrice();
    const ammPriceBefore = await amm.getSpotPrice();
    const ammPaused = await amm.paused();
    const vaultPaused = await vault.paused();
    const liquidationsBlocked = await vault.liquidationsBlocked();
    
    console.log(`Oracle Price: $${hre.ethers.formatUnits(oraclePrice[0], 8)}`);
    console.log(`AMM Price: $${hre.ethers.formatUnits(ammPriceBefore, 8)}`);
    console.log(`AMM Paused: ${ammPaused}`);
    console.log(`Vault Paused: ${vaultPaused}`);
    console.log(`Liquidations Blocked: ${liquidationsBlocked}`);

    // Check if already protected
    if (ammPaused) {
        console.log("\n🛡️ AMM IS ALREADY PAUSED!");
        console.log("🛡️ Attack cannot proceed - defense is active.");
        console.log("🛡️ The AI agent has protected the protocol!");
        return;
    }

    // Step 2: Prepare attack (this is observable by agent)
    console.log("\n⚔️ STEP 2: Preparing Attack");
    console.log("━".repeat(50));
    
    const attackAmount = hre.ethers.parseEther("50");
    console.log(`Attack Amount: 50 WETH`);
    
    console.log("🪙 Minting attack tokens...");
    const mintTx = await weth.mint(attacker.address, attackAmount);
    await mintTx.wait();
    console.log("✅ Minted 50 WETH");
    
    console.log("✅ Approving AMM...");
    const approveTx = await weth.approve(addresses.AMM, attackAmount);
    await approveTx.wait();
    console.log("✅ Approved");

    // Step 3: Signal attack intent (agent might catch this)
    console.log("\n⏳ STEP 3: Signaling Attack Intent");
    console.log("━".repeat(50));
    console.log("📡 Broadcasting preparation transactions...");
    console.log("🔄 Waiting 2 seconds for agent to detect...");
    await sleep(2000);

    // Step 4: Check if agent paused during our preparation
    const ammPausedNow = await amm.paused();
    if (ammPausedNow) {
        console.log("\n🛡️🛡️🛡️ DEFENSE ACTIVATED! 🛡️🛡️🛡️");
        console.log("The AI agent detected our preparation and paused the AMM!");
        console.log("Attack BLOCKED before execution!");
        return;
    }

    // Step 5: Execute the attack swap
    console.log("\n💥 STEP 4: Executing Attack Swap");
    console.log("━".repeat(50));
    
    try {
        console.log("📤 Sending swap transaction...");
        const tx = await amm.swapWethForUsdc(attackAmount, { gasLimit: 500000 });
        console.log(`📝 TX Hash: ${tx.hash}`);
        
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            // Swap succeeded - calculate damage
            const ammPriceAfter = await amm.getSpotPrice();
            const priceBefore = Number(hre.ethers.formatUnits(ammPriceBefore, 8));
            const priceAfter = Number(hre.ethers.formatUnits(ammPriceAfter, 8));
            const crashPercent = ((priceBefore - priceAfter) / priceBefore * 100).toFixed(1);
            
            console.log("\n❌❌❌ ATTACK SUCCEEDED! ❌❌❌");
            console.log(`Price BEFORE: $${priceBefore.toFixed(2)}`);
            console.log(`Price AFTER:  $${priceAfter.toFixed(2)}`);
            console.log(`Price CRASH:  ${crashPercent}%`);
            console.log("\n⚠️ The protocol was NOT protected!");
            console.log("⚠️ Liquidations could occur at manipulated price!");
            
        } else {
            console.log("\n🛡️ Transaction failed unexpectedly");
        }
        
    } catch (error) {
        // Check the specific error
        const errorMsg = error.message || "";
        
        if (errorMsg.includes("paused") || errorMsg.includes("AMM is paused")) {
            console.log("\n🛡️🛡️🛡️ ATTACK BLOCKED! 🛡️🛡️🛡️");
            console.log("━".repeat(50));
            console.log("The AMM rejected our swap because it's PAUSED!");
            console.log("The AI agent detected the attack and protected the protocol!");
            console.log("\n✅ Defense successful:");
            console.log("   • No price manipulation occurred");
            console.log("   • No liquidations at fake prices");
            console.log("   • User funds are SAFE");
            console.log("   • Attacker lost gas fees only");
        } else if (errorMsg.includes("revert") || errorMsg.includes("reverted")) {
            console.log("\n🛡️ ATTACK BLOCKED!");
            console.log(`Reason: ${errorMsg.split('\n')[0]}`);
        } else {
            console.log("\n❌ Attack failed with error:");
            console.log(errorMsg.split('\n')[0]);
        }
    }

    // Step 6: Final state check
    console.log("\n📊 STEP 5: Final State");
    console.log("━".repeat(50));
    const finalAmmPrice = await amm.getSpotPrice();
    const finalAmmPaused = await amm.paused();
    const finalVaultPaused = await vault.paused();
    const finalLiqBlocked = await vault.liquidationsBlocked();
    
    console.log(`AMM Price: $${hre.ethers.formatUnits(finalAmmPrice, 8)}`);
    console.log(`AMM Paused: ${finalAmmPaused}`);
    console.log(`Vault Paused: ${finalVaultPaused}`);
    console.log(`Liquidations Blocked: ${finalLiqBlocked}`);
    
    if (finalAmmPaused || finalVaultPaused || finalLiqBlocked) {
        console.log("\n🛡️ Protocol is in PROTECTED state");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Script error:", error.message);
        process.exit(1);
    });
