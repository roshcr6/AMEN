const hre = require("hardhat");

async function main() {
    const deployment = require("../deployments/sepolia-deployment.json");
    const amm = await hre.ethers.getContractAt("SimpleAMM", deployment.contracts.AMM);
    const reserves = await amm.getReserves();
    
    console.log("AMM Address:", deployment.contracts.AMM);
    console.log("WETH Reserve:", hre.ethers.formatEther(reserves[0]));
    console.log("USDC Reserve:", hre.ethers.formatUnits(reserves[1], 6));
    console.log("Price: $" + (Number(hre.ethers.formatUnits(reserves[1], 6)) / Number(hre.ethers.formatEther(reserves[0]))).toFixed(2));
}

main();
