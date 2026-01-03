const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Setup Security Agent Permissions
 * 
 * This script:
 * 1. Reads deployment addresses
 * 2. Sets the security agent address on all contracts
 * 3. Grants pause/block permissions to the agent
 */

async function main() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("              AMEN - Security Agent Setup Script                ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");

    // Load deployment info
    const deploymentPath = path.join(
        __dirname, 
        "..", 
        "deployments", 
        `${hre.network.name}-deployment.json`
    );

    if (!fs.existsSync(deploymentPath)) {
        console.error("❌ Deployment file not found. Run deploy.js first.");
        process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    console.log("📋 Loaded deployment from:", deploymentPath);

    // Get agent address from environment
    const agentPrivateKey = process.env.AGENT_PRIVATE_KEY;
    if (!agentPrivateKey) {
        console.error("❌ AGENT_PRIVATE_KEY not set in .env");
        process.exit(1);
    }

    const agentWallet = new hre.ethers.Wallet(agentPrivateKey, hre.ethers.provider);
    console.log("🤖 Agent address:", agentWallet.address);
    
    const agentBalance = await hre.ethers.provider.getBalance(agentWallet.address);
    console.log("💰 Agent balance:", hre.ethers.formatEther(agentBalance), "ETH");

    if (agentBalance < hre.ethers.parseEther("0.01")) {
        console.warn("⚠️  Warning: Agent has low balance. Send Sepolia ETH for gas.");
    }

    // Get deployer (owner) account
    const [deployer] = await hre.ethers.getSigners();
    console.log("👤 Owner address:", deployer.address);
    console.log("");

    // =========================================================================
    // Set Security Agent on Oracle
    // =========================================================================
    console.log("🔐 Setting security agent on PriceOracle...");
    const oracle = await hre.ethers.getContractAt(
        "PriceOracle",
        deployment.contracts.ORACLE
    );
    await oracle.setSecurityAgent(agentWallet.address);
    console.log("   ✅ Oracle security agent set");

    // Also authorize agent as price updater (for testing)
    await oracle.addAuthorizedUpdater(agentWallet.address);
    console.log("   ✅ Agent authorized as price updater");

    // =========================================================================
    // Set Security Agent on AMM
    // =========================================================================
    console.log("🔐 Setting security agent on SimpleAMM...");
    const amm = await hre.ethers.getContractAt(
        "SimpleAMM",
        deployment.contracts.AMM
    );
    await amm.setSecurityAgent(agentWallet.address);
    console.log("   ✅ AMM security agent set");

    // =========================================================================
    // Set Security Agent on LendingVault
    // =========================================================================
    console.log("🔐 Setting security agent on LendingVault...");
    const vault = await hre.ethers.getContractAt(
        "LendingVault",
        deployment.contracts.LENDING_VAULT
    );
    await vault.setSecurityAgent(agentWallet.address);
    console.log("   ✅ LendingVault security agent set");

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                ✅ Agent Setup Complete!                        ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
    console.log("🤖 Agent Capabilities:");
    console.log("   - Can pause/unpause AMM");
    console.log("   - Can pause/unpause LendingVault");
    console.log("   - Can block/unblock liquidations");
    console.log("   - Can flag oracle manipulations");
    console.log("   - Can update oracle price (for testing)");
    console.log("");
    console.log("⏭️  Next: Start the Python agent with 'python agent/main.py'");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Setup failed:", error);
        process.exit(1);
    });
