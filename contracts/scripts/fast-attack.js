const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Fast Attack Simulation - Quick price manipulation
 */

async function main() {
    console.log("🚨 Fast Attack Simulation...");
    
    // Load deployment
    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const addresses = deployment.contracts;

    const [attacker] = await hre.ethers.getSigners();
    
    // Get contracts
    const weth = await hre.ethers.getContractAt("MockWETH", addresses.WETH);
    const amm = await hre.ethers.getContractAt("SimpleAMM", addresses.AMM);
    const oracle = await hre.ethers.getContractAt("PriceOracle", addresses.ORACLE);

    // Check initial prices
    const oraclePrice = await oracle.getPrice();
    const ammPriceBefore = await amm.getSpotPrice();
    console.log("📊 Before: Oracle $" + hre.ethers.formatUnits(oraclePrice[0], 8) + ", AMM $" + hre.ethers.formatUnits(ammPriceBefore, 18).slice(0, 7));

    // Attack with 50 WETH dump
    const attackAmount = hre.ethers.parseEther("50");
    
    console.log("🪙 Minting attack tokens...");
    await (await weth.mint(attacker.address, attackAmount)).wait();
    
    console.log("✅ Approving...");
    await (await weth.approve(addresses.AMM, attackAmount)).wait();

    console.log("💥 Executing swap attack...");
    try {
        const tx = await amm.swapWethForUsdc(attackAmount);
        await tx.wait();
        
        const ammPriceAfter = await amm.getSpotPrice();
        const priceBefore = Number(hre.ethers.formatUnits(ammPriceBefore, 18));
        const priceAfter = Number(hre.ethers.formatUnits(ammPriceAfter, 18));
        const crash = ((priceBefore - priceAfter) / priceBefore * 100).toFixed(1);
        
        console.log("❌ ATTACK SUCCEEDED! Price crashed " + crash + "% to $" + priceAfter.toFixed(2));
    } catch (error) {
        console.log("🛡️ ATTACK BLOCKED! " + error.message.split('\n')[0]);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Error:", error.message);
        process.exit(1);
    });
