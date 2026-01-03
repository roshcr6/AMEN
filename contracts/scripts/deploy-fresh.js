const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("           AMEN - Fresh Deployment with Clean AMM              ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Deployer:", deployer.address);
    console.log("");

    // Deploy Mock Tokens
    console.log("📦 Deploying Mock Tokens...");
    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    const weth = await MockWETH.deploy();
    await weth.waitForDeployment();
    console.log("   ✅ WETH:", await weth.getAddress());

    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    console.log("   ✅ USDC:", await usdc.getAddress());
    console.log("");

    // Deploy Oracle
    console.log("🔮 Deploying Price Oracle...");
    const PriceOracle = await hre.ethers.getContractFactory("PriceOracle");
    const oracle = await PriceOracle.deploy(
        hre.ethers.parseUnits("2000", 18) // $2000 initial price
    );
    await oracle.waitForDeployment();
    console.log("   ✅ Oracle:", await oracle.getAddress());
    console.log("");

    // Deploy AMM
    console.log("💱 Deploying Simple AMM...");
    const SimpleAMM = await hre.ethers.getContractFactory("SimpleAMM");
    const amm = await SimpleAMM.deploy(
        await weth.getAddress(),
        await usdc.getAddress()
    );
    await amm.waitForDeployment();
    console.log("   ✅ AMM:", await amm.getAddress());
    console.log("");

    // Deploy Lending Vault
    console.log("🏦 Deploying Lending Vault...");
    const LendingVault = await hre.ethers.getContractFactory("LendingVault");
    const vault = await LendingVault.deploy(
        await weth.getAddress(),
        await usdc.getAddress(),
        await oracle.getAddress()
    );
    await vault.waitForDeployment();
    console.log("   ✅ Vault:", await vault.getAddress());
    console.log("");

    // Setup agent authorization (use deployer as agent for now)
    console.log("🔐 Setting up agent authorization...");
    await oracle.setSecurityAgent(deployer.address);
    await amm.setSecurityAgent(deployer.address);
    await vault.setSecurityAgent(deployer.address);
    console.log("   ✅ Agent authorized:", deployer.address);
    console.log("");

    // Add initial liquidity at $2000/ETH
    console.log("💧 Adding Initial Liquidity (20 WETH + 40,000 USDC)...");
    const wethAmount = hre.ethers.parseEther("20");
    const usdcAmount = hre.ethers.parseUnits("40000", 6);

    const balance = await weth.balanceOf(deployer.address);
    console.log("   Deployer WETH balance:", hre.ethers.formatEther(balance));

    await weth.mint(deployer.address, wethAmount);
    await usdc.mint(deployer.address, usdcAmount);
    
    console.log("   Approving tokens...");
    await weth.approve(await amm.getAddress(), wethAmount);
    await usdc.approve(await amm.getAddress(), usdcAmount);
    
    console.log("   Calling addLiquidity...");
    try {
        const liquidityTx = await amm.addLiquidity(wethAmount, usdcAmount);
        await liquidityTx.wait();
        console.log("   ✅ Liquidity added!");
    } catch (error) {
        console.error("   ❌ Add liquidity failed:", error.message);
        console.log("   Attempting without pause check...");
        // Try unpausing first
        await amm.unpause();
        const liquidityTx = await amm.addLiquidity(wethAmount, usdcAmount);
        await liquidityTx.wait();
        console.log("   ✅ Liquidity added after unpause!");
    }
    console.log("");

    // Verify AMM price
    const reserves = await amm.getReserves();
    const price = Number(hre.ethers.formatUnits(reserves[1], 6)) / Number(hre.ethers.formatEther(reserves[0]));
    console.log("📊 AMM Spot Price:", "$" + price.toFixed(2));
    console.log("");

    // Save deployment
    const deployment = {
        network: "sepolia",
        chainId: 11155111,
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: {
            WETH: await weth.getAddress(),
            USDC: await usdc.getAddress(),
            ORACLE: await oracle.getAddress(),
            AMM: await amm.getAddress(),
            LENDING_VAULT: await vault.getAddress()
        }
    };

    const deploymentPath = path.join(__dirname, "../deployments/sepolia-deployment.json");
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log("💾 Deployment saved to:", deploymentPath);
    console.log("");

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                  ✅ Deployment Complete!                      ");
    console.log("═══════════════════════════════════════════════════════════════");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
