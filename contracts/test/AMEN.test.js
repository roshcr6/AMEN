const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * AMEN Contract Tests
 * Validates core security functionality
 */

describe("AMEN Protocol", function () {
    let owner, agent, attacker, victim;
    let weth, usdc, oracle, amm, vault;

    // Initial prices
    const INITIAL_ETH_PRICE = ethers.parseUnits("2000", 8); // $2000 with 8 decimals
    const MANIPULATED_PRICE = ethers.parseUnits("1200", 8); // $1200 (40% drop)

    beforeEach(async function () {
        [owner, agent, attacker, victim] = await ethers.getSigners();

        // Deploy tokens
        const MockWETH = await ethers.getContractFactory("MockWETH");
        weth = await MockWETH.deploy();

        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        // Deploy oracle
        const PriceOracle = await ethers.getContractFactory("PriceOracle");
        oracle = await PriceOracle.deploy(INITIAL_ETH_PRICE);

        // Deploy AMM
        const SimpleAMM = await ethers.getContractFactory("SimpleAMM");
        amm = await SimpleAMM.deploy(await weth.getAddress(), await usdc.getAddress());

        // Deploy vault
        const LendingVault = await ethers.getContractFactory("LendingVault");
        vault = await LendingVault.deploy(
            await weth.getAddress(),
            await usdc.getAddress(),
            await oracle.getAddress()
        );

        // Setup: Set security agent
        await oracle.setSecurityAgent(agent.address);
        await amm.setSecurityAgent(agent.address);
        await vault.setSecurityAgent(agent.address);

        // Setup: Add AMM liquidity
        await weth.mint(owner.address, ethers.parseEther("100"));
        await usdc.mint(owner.address, ethers.parseUnits("200000", 6));
        
        await weth.approve(await amm.getAddress(), ethers.parseEther("100"));
        await usdc.approve(await amm.getAddress(), ethers.parseUnits("200000", 6));
        await amm.addLiquidity(ethers.parseEther("100"), ethers.parseUnits("200000", 6));

        // Setup: Add vault liquidity
        await usdc.mint(owner.address, ethers.parseUnits("500000", 6));
        await usdc.approve(await vault.getAddress(), ethers.parseUnits("500000", 6));
        await vault.addLiquidity(ethers.parseUnits("500000", 6));

        // Setup: Create victim position
        await weth.mint(victim.address, ethers.parseEther("10"));
        await weth.connect(victim).approve(await vault.getAddress(), ethers.parseEther("5"));
        await vault.connect(victim).depositCollateral(ethers.parseEther("5"));
        await vault.connect(victim).borrow(ethers.parseUnits("5000", 6));
    });

    describe("Token Contracts", function () {
        it("should mint WETH correctly", async function () {
            const balance = await weth.balanceOf(owner.address);
            expect(balance).to.be.gt(0);
        });

        it("should have correct USDC decimals", async function () {
            expect(await usdc.decimals()).to.equal(6);
        });
    });

    describe("Price Oracle", function () {
        it("should return initial price", async function () {
            const [price, , ] = await oracle.getPrice();
            expect(price).to.equal(INITIAL_ETH_PRICE);
        });

        it("should emit event on price update", async function () {
            const newPrice = ethers.parseUnits("2100", 8);
            await expect(oracle.updatePrice(newPrice))
                .to.emit(oracle, "PriceUpdated");
        });

        it("should only allow authorized updaters", async function () {
            await expect(
                oracle.connect(attacker).updatePrice(MANIPULATED_PRICE)
            ).to.be.revertedWith("Not authorized to update price");
        });
    });

    describe("AMM Pool", function () {
        it("should have correct reserves after initial liquidity", async function () {
            const [wethReserve, usdcReserve, ] = await amm.getReserves();
            expect(wethReserve).to.equal(ethers.parseEther("100"));
            expect(usdcReserve).to.equal(ethers.parseUnits("200000", 6));
        });

        it("should execute swaps correctly", async function () {
            await weth.mint(attacker.address, ethers.parseEther("1"));
            await weth.connect(attacker).approve(await amm.getAddress(), ethers.parseEther("1"));
            
            const usdcBefore = await usdc.balanceOf(attacker.address);
            await amm.connect(attacker).swapWethForUsdc(ethers.parseEther("1"));
            const usdcAfter = await usdc.balanceOf(attacker.address);
            
            expect(usdcAfter).to.be.gt(usdcBefore);
        });

        it("should be pausable by security agent", async function () {
            await amm.connect(agent).pause();
            expect(await amm.paused()).to.be.true;
            
            await weth.mint(attacker.address, ethers.parseEther("1"));
            await weth.connect(attacker).approve(await amm.getAddress(), ethers.parseEther("1"));
            
            await expect(
                amm.connect(attacker).swapWethForUsdc(ethers.parseEther("1"))
            ).to.be.revertedWith("AMM is paused");
        });
    });

    describe("Lending Vault", function () {
        it("should create victim position correctly", async function () {
            const [collateral, debt, healthFactor, , ] = await vault.getPosition(victim.address);
            expect(collateral).to.equal(ethers.parseEther("5"));
            expect(debt).to.equal(ethers.parseUnits("5000", 6));
            expect(healthFactor).to.be.gt(15000); // > 150%
        });

        it("should not allow liquidation of healthy position", async function () {
            await usdc.mint(attacker.address, ethers.parseUnits("5000", 6));
            await usdc.connect(attacker).approve(await vault.getAddress(), ethers.parseUnits("5000", 6));
            
            await expect(
                vault.connect(attacker).liquidate(victim.address, ethers.parseUnits("1000", 6))
            ).to.be.revertedWith("Position is healthy - cannot liquidate");
        });

        it("should allow liquidation after oracle manipulation", async function () {
            // Manipulate oracle price down
            await oracle.forceUpdatePrice(MANIPULATED_PRICE);
            
            // Check position is now liquidatable
            const [isLiquidatable, ] = await vault.isLiquidatable(victim.address);
            expect(isLiquidatable).to.be.true;
            
            // Attacker can now liquidate
            await usdc.mint(attacker.address, ethers.parseUnits("5000", 6));
            await usdc.connect(attacker).approve(await vault.getAddress(), ethers.parseUnits("5000", 6));
            
            await expect(
                vault.connect(attacker).liquidate(victim.address, ethers.parseUnits("1000", 6))
            ).to.emit(vault, "Liquidation");
        });
    });

    describe("Security Agent Protection", function () {
        it("should prevent liquidation when blocked by agent", async function () {
            // Manipulate oracle
            await oracle.forceUpdatePrice(MANIPULATED_PRICE);
            
            // Agent blocks liquidations
            await vault.connect(agent).blockLiquidations();
            expect(await vault.liquidationsBlocked()).to.be.true;
            
            // Attacker cannot liquidate even with manipulated price
            await usdc.mint(attacker.address, ethers.parseUnits("5000", 6));
            await usdc.connect(attacker).approve(await vault.getAddress(), ethers.parseUnits("5000", 6));
            
            await expect(
                vault.connect(attacker).liquidate(victim.address, ethers.parseUnits("1000", 6))
            ).to.be.revertedWith("Liquidations are blocked");
        });

        it("should pause entire protocol on emergency", async function () {
            await vault.connect(agent).pause("Flash loan attack detected");
            expect(await vault.paused()).to.be.true;
            
            // All operations blocked
            await weth.mint(attacker.address, ethers.parseEther("1"));
            await weth.connect(attacker).approve(await vault.getAddress(), ethers.parseEther("1"));
            
            await expect(
                vault.connect(attacker).depositCollateral(ethers.parseEther("1"))
            ).to.be.revertedWith("Protocol is paused");
        });

        it("should flag oracle manipulation", async function () {
            await expect(
                oracle.connect(agent).flagManipulation("Suspicious price deviation detected")
            ).to.emit(oracle, "ManipulationFlagged");
        });
    });

    describe("Attack Simulation", function () {
        it("full flash loan attack scenario - BLOCKED", async function () {
            // Step 1: Initial state
            const [initialHF, ] = await vault.isLiquidatable(victim.address);
            expect(initialHF).to.be.false; // Victim is healthy
            
            // Step 2: Attacker manipulates AMM (large swap)
            await weth.mint(attacker.address, ethers.parseEther("50"));
            await weth.connect(attacker).approve(await amm.getAddress(), ethers.parseEther("50"));
            await amm.connect(attacker).swapWethForUsdc(ethers.parseEther("50"));
            
            // Step 3: Attacker manipulates oracle
            await oracle.forceUpdatePrice(MANIPULATED_PRICE);
            
            // Step 4: Victim is now liquidatable
            const [nowLiquidatable, ] = await vault.isLiquidatable(victim.address);
            expect(nowLiquidatable).to.be.true;
            
            // Step 5: AGENT INTERVENES - Blocks liquidations
            await vault.connect(agent).blockLiquidations();
            
            // Step 6: Attacker's liquidation FAILS
            await usdc.mint(attacker.address, ethers.parseUnits("5000", 6));
            await usdc.connect(attacker).approve(await vault.getAddress(), ethers.parseUnits("5000", 6));
            
            await expect(
                vault.connect(attacker).liquidate(victim.address, ethers.parseUnits("1000", 6))
            ).to.be.revertedWith("Liquidations are blocked");
            
            // Step 7: Restore prices
            await oracle.forceUpdatePrice(INITIAL_ETH_PRICE);
            
            // Step 8: Victim is safe
            const [stillLiquidatable, ] = await vault.isLiquidatable(victim.address);
            expect(stillLiquidatable).to.be.false;
        });
    });
});
