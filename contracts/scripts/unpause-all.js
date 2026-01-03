const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Unpause AMM and Vault - Reset protocol to normal state
 * Used after testing to allow new attacks
 */

async function main() {
    console.log("🔓 Resetting Protocol to Normal State\n");
    
    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [owner] = await hre.ethers.getSigners();
    console.log("Owner:", owner.address);
    
    // Get contracts
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const vault = await hre.ethers.getContractAt("LendingVault", addresses.LENDING_VAULT);

    // Check current state
    console.log("\n📋 Current State:");
    console.log("━".repeat(40));
    
    let ammPaused = await amm.paused();
    let vaultPaused = await vault.paused();
    let liqBlocked = await vault.liquidationsBlocked();
    
    console.log(`AMM Paused: ${ammPaused}`);
    console.log(`Vault Paused: ${vaultPaused}`);
    console.log(`Liquidations Blocked: ${liqBlocked}`);

    // Unpause AMM
    if (ammPaused) {
        console.log("\n📤 Unpausing AMM...");
        try {
            const tx = await amm.unpause();
            await tx.wait();
            console.log("✅ AMM unpaused!");
        } catch (error) {
            console.log("❌ Failed to unpause AMM:", error.message.split('\n')[0]);
        }
    } else {
        console.log("\nℹ️ AMM already unpaused");
    }

    // Unpause Vault
    if (vaultPaused) {
        console.log("📤 Unpausing Vault...");
        try {
            const tx = await vault.unpause();
            await tx.wait();
            console.log("✅ Vault unpaused!");
        } catch (error) {
            console.log("❌ Failed to unpause Vault:", error.message.split('\n')[0]);
        }
    } else {
        console.log("ℹ️ Vault already unpaused");
    }

    // Unblock liquidations
    if (liqBlocked) {
        console.log("📤 Unblocking liquidations...");
        try {
            const tx = await vault.unblockLiquidations();
            await tx.wait();
            console.log("✅ Liquidations unblocked!");
        } catch (error) {
            console.log("❌ Failed to unblock liquidations:", error.message.split('\n')[0]);
        }
    } else {
        console.log("ℹ️ Liquidations already unblocked");
    }

    // Verify final state
    console.log("\n📋 Final State:");
    console.log("━".repeat(40));
    
    ammPaused = await amm.paused();
    vaultPaused = await vault.paused();
    liqBlocked = await vault.liquidationsBlocked();
    
    console.log(`AMM Paused: ${ammPaused}`);
    console.log(`Vault Paused: ${vaultPaused}`);
    console.log(`Liquidations Blocked: ${liqBlocked}`);

    if (!ammPaused && !vaultPaused && !liqBlocked) {
        console.log("\n✅ Protocol is now in NORMAL operating state");
        console.log("   Ready for new attack simulations!");
    } else {
        console.log("\n⚠️ Some components still protected");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
