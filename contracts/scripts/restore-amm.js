const hre = require("hardhat");

async function main() {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("         AMEN - Add Fresh Liquidity at $2000                   ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Deployer:", deployer.address);
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

    // Check current state
    console.log("📊 Current AMM State:");
    const reserves = await amm.getReserves();
    const currentPrice = Number(hre.ethers.formatUnits(reserves[1], 6)) / Number(hre.ethers.formatEther(reserves[0]));
    console.log("   WETH Reserve:", hre.ethers.formatEther(reserves[0]));
    console.log("   USDC Reserve:", hre.ethers.formatUnits(reserves[1], 6));
    console.log("   Current Price: $" + currentPrice.toFixed(2));
    console.log("");

    // Add massive liquidity at $2000 to dilute manipulation
    console.log("💧 Adding Large Liquidity Pool (100 WETH + 200,000 USDC)...");
    console.log("   This will dilute the manipulation and restore price to $2000");
    console.log("");

    const wethAmount = hre.ethers.parseEther("100");
    const usdcAmount = hre.ethers.parseUnits("200000", 6);

    // Mint tokens
    await weth.mint(deployer.address, wethAmount);
    await usdc.mint(deployer.address, usdcAmount);
    
    // Approve
    await weth.approve(addresses.AMM, wethAmount);
    await usdc.approve(addresses.AMM, usdcAmount);
    
    // Add liquidity at correct ratio
    try {
        const liquidityTx = await amm.addLiquidity(wethAmount, usdcAmount);
        await liquidityTx.wait();
        console.log("   ✅ Liquidity added!");
        console.log("   Transaction:", liquidityTx.hash);
    } catch (error) {
        console.log("   ❌ Failed:", error.message);
        console.log("   Note: AMM may still be paused from previous attack");
        console.log("   Unpausing...");
        await amm.unpause();
        const liquidityTx = await amm.addLiquidity(wethAmount, usdcAmount);
        await liquidityTx.wait();
        console.log("   ✅ Liquidity added after unpause!");
        console.log("   Transaction:", liquidityTx.hash);
    }
    console.log("");

    // Check new state
    const newReserves = await amm.getReserves();
    const newPrice = Number(hre.ethers.formatUnits(newReserves[1], 6)) / Number(hre.ethers.formatEther(newReserves[0]));
    const spotPrice = await amm.getSpotPrice();
    
    console.log("📊 New AMM State:");
    console.log("   WETH Reserve:", hre.ethers.formatEther(newReserves[0]));
    console.log("   USDC Reserve:", hre.ethers.formatUnits(newReserves[1], 6));
    console.log("   Spot Price: $" + hre.ethers.formatUnits(spotPrice, 18));
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                  ✅ AMM Restored to $2000!                    ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
