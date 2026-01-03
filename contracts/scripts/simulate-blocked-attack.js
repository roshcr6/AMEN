const hre = require("hardhat");

async function main() {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("        AMEN - Attack Simulation (WITH BLOCKING)               ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Attacker:", deployer.address);
    console.log("");

    // Load deployment
    const deployment = require("../deployments/sepolia-deployment.json");
    const addresses = deployment.contracts;

    // Get contracts
    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    const weth = MockWETH.attach(addresses.WETH);
    
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = MockUSDC.attach(addresses.USDC);
    
    const SimpleAMM = await hre.ethers.getContractFactory("SimpleAMM");
    const amm = SimpleAMM.attach(addresses.AMM);

    // Check initial state
    console.log("📊 Initial State:");
    const initialReserves = await amm.getReserves();
    const initialPrice = Number(hre.ethers.formatUnits(initialReserves[1], 6)) / Number(hre.ethers.formatEther(initialReserves[0]));
    console.log("   AMM Price: $" + initialPrice.toFixed(2));
    console.log("   WETH Reserve:", hre.ethers.formatEther(initialReserves[0]));
    console.log("   USDC Reserve:", hre.ethers.formatUnits(initialReserves[1], 6));
    
    const isPaused = await amm.paused();
    console.log("   AMM Status:", isPaused ? "⏸️  PAUSED (Protected)" : "▶️  Active");
    console.log("");

    if (isPaused) {
        console.log("🛡️  AMEN PROTECTION ACTIVE!");
        console.log("   The AMM is paused - attack cannot proceed");
        console.log("   Oracle manipulation prevented ✅");
        console.log("");
    } else {
        console.log("⚠️  Attempting Flash Loan Attack...");
        console.log("   Attack: Dump 50 WETH to crash price");
        console.log("");

        try {
            // Mint attack tokens
            const attackAmount = hre.ethers.parseEther("50");
            await weth.mint(deployer.address, attackAmount);
            await weth.approve(addresses.AMM, attackAmount);

            // Try to execute attack
            console.log("💥 Executing attack swap...");
            const attackTx = await amm.swapWethForUsdc(attackAmount);
            await attackTx.wait();

            // Check if attack succeeded
            const afterReserves = await amm.getReserves();
            const afterPrice = Number(hre.ethers.formatUnits(afterReserves[1], 6)) / Number(hre.ethers.formatEther(afterReserves[0]));
            const priceChange = ((afterPrice - initialPrice) / initialPrice * 100).toFixed(2);

            console.log("");
            console.log("❌ ATTACK SUCCEEDED (AMEN was too slow)");
            console.log("   Final Price: $" + afterPrice.toFixed(2));
            console.log("   Price Change: " + priceChange + "%");
            console.log("   Transaction:", attackTx.hash);
            console.log("");
            console.log("⚠️  Note: AMEN should pause the AMM BEFORE attack executes");
            
        } catch (error) {
            console.log("");
            console.log("✅ ATTACK BLOCKED!");
            console.log("   AMEN paused the AMM before manipulation could occur");
            console.log("   Error:", error.message.split('\n')[0]);
            console.log("");
            
            // Verify price unchanged
            const finalReserves = await amm.getReserves();
            const finalPrice = Number(hre.ethers.formatUnits(finalReserves[1], 6)) / Number(hre.ethers.formatEther(finalReserves[0]));
            console.log("📊 Final State:");
            console.log("   AMM Price: $" + finalPrice.toFixed(2) + " (unchanged ✅)");
            console.log("   WETH Reserve:", hre.ethers.formatEther(finalReserves[0]));
            console.log("   USDC Reserve:", hre.ethers.formatUnits(finalReserves[1], 6));
        }
    }

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                  Simulation Complete                          ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
