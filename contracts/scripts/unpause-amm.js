const hre = require("hardhat");

async function main() {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                  AMEN - Unpause AMM                           ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Deployer:", deployer.address);
    console.log("");

    // Load deployment
    const deployment = require("../deployments/sepolia-deployment.json");
    const addresses = deployment.contracts;

    // Get contract
    const SimpleAMM = await hre.ethers.getContractFactory("SimpleAMM");
    const amm = SimpleAMM.attach(addresses.AMM);

    // Check pause status
    const isPaused = await amm.paused();
    console.log("📊 Current Status:");
    console.log("   Paused:", isPaused);
    console.log("");

    if (isPaused) {
        console.log("▶️  Unpausing AMM...");
        const tx = await amm.unpause();
        await tx.wait();
        console.log("   ✅ AMM unpaused!");
        console.log("   Transaction:", tx.hash);
    } else {
        console.log("   ℹ️  AMM is already unpaused");
    }

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                  ✅ Done!                                      ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
