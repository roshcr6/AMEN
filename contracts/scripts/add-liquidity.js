const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Add Liquidity to AMM
 * This script adds initial liquidity to make the AMM functional
 */

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("              AMEN - Add AMM Liquidity Script                   ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    // Load deployment addresses
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    if (!fs.existsSync(deploymentPath)) {
        console.error("❌ Deployment file not found. Run deploy.js first.");
        process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    // Get deployer
    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Deployer:", deployer.address);
    console.log("");

    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const usdc = await hre.ethers.getContractAt("MockUSDC", addresses.USDC);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);

    // Check balances
    const wethBalance = await weth.balanceOf(deployer.address);
    const usdcBalance = await usdc.balanceOf(deployer.address);
    console.log("💰 Current Balances:");
    console.log("   WETH:", hre.ethers.formatEther(wethBalance));
    console.log("   USDC:", hre.ethers.formatUnits(usdcBalance, 6));
    console.log("");

    // Mint tokens if needed
    const wethNeeded = hre.ethers.parseEther("10");
    const usdcNeeded = hre.ethers.parseUnits("20000", 6); // 10 WETH * $2000

    if (wethBalance < wethNeeded) {
        console.log("🪙 Minting WETH...");
        const tx1 = await weth.mint(deployer.address, wethNeeded);
        await tx1.wait();
        console.log("   ✅ Minted 10 WETH");
    }

    if (usdcBalance < usdcNeeded) {
        console.log("🪙 Minting USDC...");
        const tx2 = await usdc.mint(deployer.address, usdcNeeded);
        await tx2.wait();
        console.log("   ✅ Minted 20,000 USDC");
    }
    console.log("");

    // Approve AMM
    console.log("✅ Approving tokens...");
    const approveTx1 = await weth.approve(addresses.AMM, wethNeeded);
    await approveTx1.wait();
    console.log("   ✅ WETH approved");

    const approveTx2 = await usdc.approve(addresses.AMM, usdcNeeded);
    await approveTx2.wait();
    console.log("   ✅ USDC approved");
    console.log("");

    // Add liquidity
    console.log("💧 Adding liquidity to AMM...");
    console.log("   Amount: 10 WETH + 20,000 USDC");
    console.log("   Target Price: $2000/ETH");
    
    const liquidityTx = await amm.addLiquidity(
        wethNeeded,
        usdcNeeded,
        { gasLimit: 500000 }
    );
    await liquidityTx.wait();
    
    console.log("   ✅ Liquidity added!");
    console.log("   Transaction:", liquidityTx.hash);
    console.log("");

    // Check AMM state
    const reserves = await amm.getReserves();
    const spotPrice = await amm.getSpotPrice();
    
    console.log("📊 AMM Status:");
    console.log("   WETH Reserve:", hre.ethers.formatEther(reserves[0]));
    console.log("   USDC Reserve:", hre.ethers.formatUnits(reserves[1], 6));
    console.log("   Spot Price: $" + hre.ethers.formatUnits(spotPrice, 18));
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                    ✅ Liquidity Added!                         ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
