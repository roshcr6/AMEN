const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * AGENT AUTO-RESTORE: Automatically restore AMM price after attack
 * This is called by the AI agent after detecting and pausing an attack
 */

async function main() {
    console.log("🔄🔄🔄 AGENT: AUTO-RESTORING AMM PRICE 🔄🔄🔄\n");

    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [signer] = await hre.ethers.getSigners();
    console.log("🤖 Agent Wallet:", signer.address);

    // Get contracts
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const usdc = await hre.ethers.getContractAt("MockUSDC", addresses.USDC);

    // Check current state
    const isPaused = await amm.paused();
    const reserves = await amm.getReserves();
    const wethReserve = Number(hre.ethers.formatEther(reserves[0]));
    const usdcReserve = Number(hre.ethers.formatUnits(reserves[1], 6));
    const currentPrice = usdcReserve / wethReserve;

    console.log("📊 Current State:");
    console.log(`   AMM Paused: ${isPaused}`);
    console.log(`   WETH Reserve: ${wethReserve.toFixed(2)}`);
    console.log(`   USDC Reserve: ${usdcReserve.toFixed(2)}`);
    console.log(`   Current Price: $${currentPrice.toFixed(2)}`);

    const targetPrice = 2000;
    const tolerance = 100;

    if (Math.abs(currentPrice - targetPrice) < tolerance) {
        console.log(`\n✅ Price already near $${targetPrice}. No restoration needed.`);
        return;
    }

    console.log(`\n🎯 Target Price: $${targetPrice}`);
    console.log(`📉 Deviation: ${(((targetPrice - currentPrice) / targetPrice) * 100).toFixed(1)}%`);

    // Step 1: Unpause AMM temporarily for restoration
    if (isPaused) {
        console.log("\n🔓 Step 1: Temporarily unpausing AMM...");
        await (await amm.unpause()).wait();
        console.log("   ✅ AMM Unpaused");
    }

    // Step 2: Calculate counter-swap amount
    // Using constant product: k = weth * usdc
    // After swap: new_usdc / new_weth = targetPrice
    const k = wethReserve * usdcReserve;
    const targetWeth = Math.sqrt(k / targetPrice);
    const targetUsdc = k / targetWeth;

    if (currentPrice < targetPrice) {
        // Price crashed - need to buy WETH with USDC to raise price
        const usdcNeeded = Math.ceil(targetUsdc - usdcReserve);

        if (usdcNeeded > 0) {
            console.log(`\n💰 Step 2: Counter-swap - Buying WETH with ${usdcNeeded} USDC...`);

            const usdcAmount = hre.ethers.parseUnits(usdcNeeded.toString(), 6);

            // Mint USDC
            console.log("   Minting USDC...");
            await (await usdc.mint(signer.address, usdcAmount)).wait();

            // Approve
            console.log("   Approving AMM...");
            await (await usdc.approve(addresses.AMM, usdcAmount)).wait();

            // Execute counter-swap
            console.log("   Executing counter-swap (USDC → WETH)...");
            await (await amm.swapUsdcForWeth(usdcAmount)).wait();
            console.log("   ✅ Counter-swap complete!");
        }
    } else {
        // Price too high - need to sell WETH
        const wethNeeded = Math.ceil(targetWeth - wethReserve);

        if (wethNeeded > 0) {
            console.log(`\n💰 Step 2: Counter-swap - Selling ${wethNeeded} WETH...`);

            const wethAmount = hre.ethers.parseEther(wethNeeded.toString());

            console.log("   Minting WETH...");
            await (await weth.mint(signer.address, wethAmount)).wait();

            console.log("   Approving AMM...");
            await (await weth.approve(addresses.AMM, wethAmount)).wait();

            console.log("   Executing counter-swap (WETH → USDC)...");
            await (await amm.swapWethForUsdc(wethAmount)).wait();
            console.log("   ✅ Counter-swap complete!");
        }
    }

    // Step 3: Verify new price
    const newReserves = await amm.getReserves();
    const newPrice = Number(hre.ethers.formatUnits(newReserves[1], 6)) / Number(hre.ethers.formatEther(newReserves[0]));
    console.log(`\n📊 New Price: $${newPrice.toFixed(2)}`);

    // Step 4: Re-pause AMM for safety
    console.log("\n🔒 Step 3: Re-pausing AMM for protection...");
    await (await amm.pause()).wait();
    console.log("   ✅ AMM Re-paused");

    console.log("\n" + "=".repeat(50));
    console.log("✅ AUTOMATIC PRICE RESTORATION COMPLETE!");
    console.log(`   Before: $${currentPrice.toFixed(2)}`);
    console.log(`   After:  $${newPrice.toFixed(2)}`);
    console.log("   Status: AMM PAUSED (Protected)");
    console.log("=".repeat(50));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Restoration failed:", error.message);
        process.exit(1);
    });
