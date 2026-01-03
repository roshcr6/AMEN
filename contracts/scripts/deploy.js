const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * AMEN DeFi Security System - Deployment Script
 * 
 * Deploys all contracts to Sepolia testnet:
 * 1. MockWETH - Wrapped ETH token
 * 2. MockUSDC - Stablecoin token
 * 3. PriceOracle - ETH/USD price feed
 * 4. SimpleAMM - WETH/USDC liquidity pool
 * 5. LendingVault - Over-collateralized lending protocol
 * 
 * After deployment, sets up initial state:
 * - Mints tokens to deployer
 * - Adds initial liquidity to AMM
 * - Adds lending liquidity to vault
 * - Sets security agent permissions
 */

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("           AMEN - Agentic Manipulation Engine Neutralizer       ");
    console.log("                    Contract Deployment Script                   ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    // Get deployer account
    const [deployer] = await hre.ethers.getSigners();
    console.log("📋 Deployer address:", deployer.address);
    
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("💰 Deployer balance:", hre.ethers.formatEther(balance), "ETH");
    console.log("");

    if (balance < hre.ethers.parseEther("0.01")) {
        console.error("❌ Insufficient balance for deployment. Need at least 0.01 ETH");
        process.exit(1);
    }

    // Track deployed addresses
    const addresses = {};

    // =========================================================================
    // 1. Deploy MockWETH
    // =========================================================================
    console.log("📦 Deploying MockWETH...");
    const MockWETH = await hre.ethers.getContractFactory("MockWETH");
    const weth = await MockWETH.deploy();
    await weth.waitForDeployment();
    addresses.WETH = await weth.getAddress();
    console.log("   ✅ MockWETH deployed to:", addresses.WETH);

    // =========================================================================
    // 2. Deploy MockUSDC
    // =========================================================================
    console.log("📦 Deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    addresses.USDC = await usdc.getAddress();
    console.log("   ✅ MockUSDC deployed to:", addresses.USDC);

    // =========================================================================
    // 3. Deploy PriceOracle
    // =========================================================================
    console.log("📦 Deploying PriceOracle...");
    // Initial ETH price: $2000 with 8 decimals = 2000 * 10^8 = 200000000000
    const initialPrice = 200000000000n; // $2000.00
    const PriceOracle = await hre.ethers.getContractFactory("PriceOracle");
    const oracle = await PriceOracle.deploy(initialPrice);
    await oracle.waitForDeployment();
    addresses.ORACLE = await oracle.getAddress();
    console.log("   ✅ PriceOracle deployed to:", addresses.ORACLE);
    console.log("   📊 Initial ETH price: $2000.00");

    // =========================================================================
    // 4. Deploy SimpleAMM
    // =========================================================================
    console.log("📦 Deploying SimpleAMM...");
    const SimpleAMM = await hre.ethers.getContractFactory("SimpleAMM");
    const amm = await SimpleAMM.deploy(addresses.WETH, addresses.USDC);
    await amm.waitForDeployment();
    addresses.AMM = await amm.getAddress();
    console.log("   ✅ SimpleAMM deployed to:", addresses.AMM);

    // =========================================================================
    // 5. Deploy LendingVault
    // =========================================================================
    console.log("📦 Deploying LendingVault...");
    const LendingVault = await hre.ethers.getContractFactory("LendingVault");
    const vault = await LendingVault.deploy(
        addresses.WETH,
        addresses.USDC,
        addresses.ORACLE
    );
    await vault.waitForDeployment();
    addresses.LENDING_VAULT = await vault.getAddress();
    console.log("   ✅ LendingVault deployed to:", addresses.LENDING_VAULT);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                    Setting Up Initial State                    ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    // =========================================================================
    // 6. Setup Initial Liquidity
    // =========================================================================
    
    // Mint additional tokens
    console.log("🪙 Minting additional tokens...");
    await weth.mint(deployer.address, hre.ethers.parseEther("1000"));
    await usdc.mint(deployer.address, 2000000n * 1000000n); // 2M USDC (6 decimals)
    console.log("   ✅ Minted 1000 WETH and 2,000,000 USDC");

    // Add liquidity to AMM (100 WETH + 200,000 USDC = $2000/ETH implied)
    console.log("💧 Adding liquidity to AMM...");
    const ammWethAmount = hre.ethers.parseEther("100"); // 100 WETH
    const ammUsdcAmount = 200000n * 1000000n; // 200,000 USDC
    
    await weth.approve(addresses.AMM, ammWethAmount);
    await usdc.approve(addresses.AMM, ammUsdcAmount);
    await amm.addLiquidity(ammWethAmount, ammUsdcAmount);
    console.log("   ✅ Added 100 WETH + 200,000 USDC to AMM pool");

    // Add lending liquidity to vault
    console.log("🏦 Adding liquidity to LendingVault...");
    const vaultUsdcAmount = 500000n * 1000000n; // 500,000 USDC
    await usdc.approve(addresses.LENDING_VAULT, vaultUsdcAmount);
    await vault.addLiquidity(vaultUsdcAmount);
    console.log("   ✅ Added 500,000 USDC lending liquidity");

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                   Deployment Summary                           ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("📋 Contract Addresses:");
    console.log("   WETH:          ", addresses.WETH);
    console.log("   USDC:          ", addresses.USDC);
    console.log("   PriceOracle:   ", addresses.ORACLE);
    console.log("   SimpleAMM:     ", addresses.AMM);
    console.log("   LendingVault:  ", addresses.LENDING_VAULT);
    console.log("");

    // =========================================================================
    // 7. Save Deployment Addresses
    // =========================================================================
    const deploymentInfo = {
        network: hre.network.name,
        chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: addresses,
        initialState: {
            oraclePrice: "200000000000", // $2000
            ammWethReserve: ammWethAmount.toString(),
            ammUsdcReserve: ammUsdcAmount.toString(),
            vaultLiquidity: vaultUsdcAmount.toString()
        }
    };

    const deploymentPath = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deploymentPath)) {
        fs.mkdirSync(deploymentPath, { recursive: true });
    }
    
    const filename = `${hre.network.name}-deployment.json`;
    fs.writeFileSync(
        path.join(deploymentPath, filename),
        JSON.stringify(deploymentInfo, null, 2)
    );
    console.log(`📄 Deployment info saved to: deployments/${filename}`);

    // Also update .env with addresses
    const envPath = path.join(__dirname, "..", "..", ".env");
    if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, "utf8");
        
        // Update or add contract addresses
        const envUpdates = {
            WETH_ADDRESS: addresses.WETH,
            USDC_ADDRESS: addresses.USDC,
            ORACLE_ADDRESS: addresses.ORACLE,
            AMM_POOL_ADDRESS: addresses.AMM,
            LENDING_VAULT_ADDRESS: addresses.LENDING_VAULT
        };

        for (const [key, value] of Object.entries(envUpdates)) {
            const regex = new RegExp(`^${key}=.*$`, "m");
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${key}=${value}`);
            } else {
                envContent += `\n${key}=${value}`;
            }
        }

        fs.writeFileSync(envPath, envContent);
        console.log("📄 Updated .env with contract addresses");
    }

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                    ✅ Deployment Complete!                     ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("⏭️  Next Steps:");
    console.log("   1. Set AGENT_PRIVATE_KEY in .env");
    console.log("   2. Run: node scripts/setup-agent.js --network sepolia");
    console.log("   3. Start the Python agent");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
