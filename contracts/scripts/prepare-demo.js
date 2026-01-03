const hre = require("hardhat");

async function main() {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("              AMEN - Reset System for Demo                     ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await hre.ethers.getSigners();

    // Load deployment
    const deployment = require("../deployments/sepolia-deployment.json");
    const addresses = deployment.contracts;

    // Get contracts
    const SimpleAMM = await hre.ethers.getContractFactory("SimpleAMM");
    const amm = SimpleAMM.attach(addresses.AMM);

    // Unpause AMM
    console.log("▶️  Unpausing AMM for fresh attack demo...");
    const isPaused = await amm.paused();
    if (isPaused) {
        await amm.unpause();
        console.log("   ✅ AMM unpaused");
    } else {
        console.log("   ℹ️  AMM already active");
    }
    console.log("");

    // Check status
    const reserves = await amm.getReserves();
    const price = Number(hre.ethers.formatUnits(reserves[1], 6)) / Number(hre.ethers.formatEther(reserves[0]));
    console.log("📊 AMM Status:");
    console.log("   Current Price: $" + price.toFixed(2));
    console.log("   Note: Price is manipulated from previous attack");
    console.log("   AMEN will block NEW attack attempts");
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("    ✅ Ready! Run simulate-blocked-attack.js to test AMEN      ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
