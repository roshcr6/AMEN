const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Reset AMM to Normal State
 * Removes old liquidity and adds fresh balanced liquidity
 */

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("              AMEN - Reset AMM to Normal State                  ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Deployer:", deployer.address);
    console.log("");

    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const usdc = await hre.ethers.getContractAt("MockUSDC", addresses.USDC);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);

    // Check current state
    console.log("📊 Current AMM State:");
    const reserves = await amm.getReserves();
    const wethRes = Number(hre.ethers.formatEther(reserves[0]));
    const usdcRes = Number(hre.ethers.formatUnits(reserves[1], 6));
    
    console.log("   WETH Reserve:", wethRes.toFixed(2));
    console.log("   USDC Reserve:", usdcRes.toFixed(2));
    
    const currentRatio = usdcRes / wethRes;
    console.log("   Current Price: $" + currentRatio.toFixed(2));
    console.log("");

    // Strategy: Many tiny swaps USDC→WETH to push price back up
    console.log("💱 Swapping USDC for WETH to restore price...");
    
    for (let i = 0; i < 100; i++) {
        const swapAmount = hre.ethers.parseUnits("50", 6); // 50 USDC per swap
        await usdc.mint(deployer.address, swapAmount);
        await usdc.approve(addresses.AMM, swapAmount);
        
        try {
            const swapTx = await amm.swapUsdcForWeth(swapAmount);
            await swapTx.wait();
            
            // Check new price every 20 swaps
            if ((i + 1) % 20 === 0) {
                const newRes = await amm.getReserves();
                const newPrice = Number(hre.ethers.formatUnits(newRes[1], 6)) / Number(hre.ethers.formatEther(newRes[0]));
                console.log(`   Swap ${i+1}/100: Price = $${newPrice.toFixed(2)}`);
                
                if (newPrice >= 1800) {
                    console.log("   ✅ Price restored!");
                    break;
                }
            }
        } catch (e) {
            console.log(`   ⚠️ Swap ${i+1} failed, stopping`);
            const newRes = await amm.getReserves();
            const newPrice = Number(hre.ethers.formatUnits(newRes[1], 6)) / Number(hre.ethers.formatEther(newRes[0]));
            console.log(`   Final Price: $${newPrice.toFixed(2)}`);
            break;
        }
    }
    console.log("");

    // Check new state
    const newReserves = await amm.getReserves();
    const spotPrice = await amm.getSpotPrice();
    
    console.log("📊 New AMM State:");
    console.log("   WETH Reserve:", hre.ethers.formatEther(newReserves[0]));
    console.log("   USDC Reserve:", hre.ethers.formatUnits(newReserves[1], 6));
    console.log("   Spot Price: $" + hre.ethers.formatUnits(spotPrice, 18));
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                  ✅ AMM Reset Complete!                        ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
