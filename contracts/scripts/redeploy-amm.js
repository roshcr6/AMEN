const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("           AMEN - Redeploy Fresh AMM at $2000                  ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Deployer:", deployer.address);

    // Load old deployment to keep same tokens and oracle
    const oldDeployment = require("../deployments/sepolia-deployment.json");
    const oldAddresses = oldDeployment.contracts;

    console.log("📦 Using existing tokens:");
    console.log("   WETH:", oldAddresses.WETH);
    console.log("   USDC:", oldAddresses.USDC);
    console.log("   Oracle:", oldAddresses.ORACLE);
    console.log("");

    // Deploy NEW AMM
    console.log("💱 Deploying Fresh AMM...");
    const SimpleAMM = await hre.ethers.getContractFactory("SimpleAMM");
    const amm = await SimpleAMM.deploy(oldAddresses.WETH, oldAddresses.USDC);
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();
    console.log("   ✅ New AMM:", ammAddress);
    console.log("");

    // Setup agent authorization
    console.log("🔐 Setting up agent authorization...");
    await amm.setSecurityAgent(deployer.address);
    console.log("   ✅ Agent authorized");
    console.log("");

    // Add initial liquidity at $2000
    console.log("💧 Adding Liquidity (20 WETH + 40,000 USDC = $2000/ETH)...");
    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    const weth = MockWETH.attach(oldAddresses.WETH);
    
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = MockUSDC.attach(oldAddresses.USDC);

    const wethAmount = hre.ethers.parseEther("20");
    const usdcAmount = hre.ethers.parseUnits("40000", 6);

    console.log("   Minting tokens...");
    const mintWethTx = await weth.mint(deployer.address, wethAmount);
    await mintWethTx.wait();
    const mintUsdcTx = await usdc.mint(deployer.address, usdcAmount);
    await mintUsdcTx.wait();
    
    console.log("   Approving tokens...");
    const approveWethTx = await weth.approve(ammAddress, wethAmount);
    await approveWethTx.wait();
    const approveUsdcTx = await usdc.approve(ammAddress, usdcAmount);
    await approveUsdcTx.wait();

    console.log("   Adding liquidity...");
    const liquidityTx = await amm.addLiquidity(wethAmount, usdcAmount);
    await liquidityTx.wait();
    console.log("   ✅ Liquidity added!");
    console.log("");

    // Verify price
    const reserves = await amm.getReserves();
    const price = Number(hre.ethers.formatUnits(reserves[1], 6)) / Number(hre.ethers.formatEther(reserves[0]));
    console.log("📊 AMM Spot Price: $" + price.toFixed(2));
    console.log("");

    // Update deployment file
    const newDeployment = {
        ...oldDeployment,
        timestamp: new Date().toISOString(),
        contracts: {
            ...oldAddresses,
            AMM: ammAddress
        }
    };

    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    fs.writeFileSync(deploymentPath, JSON.stringify(newDeployment, null, 2));
    console.log("💾 Deployment updated:", deploymentPath);
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("   ✅ Fresh AMM deployed at $2000! Update your .env files:     ");
    console.log("   AMM_POOL_ADDRESS=" + ammAddress);
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
