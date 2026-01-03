const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Fast AMM Reset - Swaps to rebalance AMM to $2000
 * Uses swaps instead of liquidity to fix price quickly
 * Now also unpauses the AMM first if needed
 */

async function main() {
    console.log("🔄 Fast AMM Reset to $2000...");
    
    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [deployer] = await hre.ethers.getSigners();
    
    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const usdc = await hre.ethers.getContractAt("MockUSDC", addresses.USDC);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const vault = await hre.ethers.getContractAt("LendingVault", addresses.LENDING_VAULT);

    // Check if AMM is paused and unpause if needed
    const isPaused = await amm.paused();
    if (isPaused) {
        console.log("⚠️ AMM is paused, unpausing first...");
        await (await amm.unpause()).wait();
        console.log("✅ AMM unpaused!");
    }

    // Also unblock liquidations if blocked
    try {
        const liquidationsBlocked = await vault.liquidationsBlocked();
        if (liquidationsBlocked) {
            console.log("⚠️ Liquidations blocked, unblocking...");
            await (await vault.unblockLiquidations()).wait();
            console.log("✅ Liquidations unblocked!");
        }
    } catch (e) {
        // Ignore if vault doesn't have this method
    }

    // Get current price
    const reserves = await amm.getReserves();
    const currentWeth = Number(hre.ethers.formatEther(reserves[0]));
    const currentUsdc = Number(hre.ethers.formatUnits(reserves[1], 6));
    const currentPrice = currentUsdc / currentWeth;
    
    console.log("📊 Current: $" + currentPrice.toFixed(2));

    if (Math.abs(currentPrice - 2000) < 100) {
        console.log("✅ AMM already near $2000!");
        return;
    }

    // If price is too low (crashed), we need to buy WETH (swap USDC for WETH)
    // If price is too high, we need to sell WETH (swap WETH for USDC)
    
    if (currentPrice < 2000) {
        // Price crashed - need to buy WETH with USDC to raise price
        // Calculate how much USDC needed to restore price
        // For constant product: after swap, new_usdc / new_weth = 2000
        // new_usdc = current_usdc + amount_in, new_weth = current_weth - amount_out
        
        // Simplified: swap a big amount of USDC to buy WETH
        const targetPrice = 2000;
        // k = currentWeth * currentUsdc (constant)
        // After: newWeth * newUsdc = k, newUsdc/newWeth = 2000
        // newUsdc = 2000 * newWeth, newWeth * 2000 * newWeth = k
        // newWeth = sqrt(k/2000)
        const k = currentWeth * currentUsdc;
        const targetWeth = Math.sqrt(k / targetPrice);
        const targetUsdc = k / targetWeth;
        
        // Need to add USDC = targetUsdc - currentUsdc
        const usdcNeeded = Math.max(0, targetUsdc - currentUsdc);
        
        if (usdcNeeded > 0) {
            console.log("💸 Buying WETH with " + usdcNeeded.toFixed(0) + " USDC...");
            const usdcAmount = hre.ethers.parseUnits(Math.ceil(usdcNeeded).toString(), 6);
            
            await (await usdc.mint(deployer.address, usdcAmount)).wait();
            await (await usdc.approve(addresses.AMM, usdcAmount)).wait();
            await (await amm.swapUsdcForWeth(usdcAmount)).wait();
        }
    } else {
        // Price too high - sell WETH
        const k = currentWeth * currentUsdc;
        const targetUsdc = Math.sqrt(k * 2000);
        const targetWeth = k / targetUsdc;
        
        const wethNeeded = Math.max(0, targetWeth - currentWeth);
        
        if (wethNeeded > 0) {
            console.log("💸 Selling " + wethNeeded.toFixed(2) + " WETH...");
            const wethAmount = hre.ethers.parseEther(Math.ceil(wethNeeded).toString());
            
            await (await weth.mint(deployer.address, wethAmount)).wait();
            await (await weth.approve(addresses.AMM, wethAmount)).wait();
            await (await amm.swapWethForUsdc(wethAmount)).wait();
        }
    }

    // Verify final price
    const newReserves = await amm.getReserves();
    const newPrice = Number(hre.ethers.formatUnits(newReserves[1], 6)) / Number(hre.ethers.formatEther(newReserves[0]));
    console.log("✅ AMM Reset! New price: $" + newPrice.toFixed(2));
    
    // If still not close, do another iteration
    if (Math.abs(newPrice - 2000) > 200) {
        console.log("⚠️ Price still off, doing another adjustment...");
        // Recursive call but limited
        await main();
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Error:", error.message);
        process.exit(1);
    });
