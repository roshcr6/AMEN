# AMEN - Quick Summary

## What We Built

**AMEN (Agentic Manipulation Engine Neutralizer)** - An AI-powered security system that protects DeFi protocols from flash loan attacks using Google Gemini 2.0 Flash LLM.

---

## The Problem 💥

**Flash Loan Attacks** have caused over **$1 Billion** in losses in DeFi:
- Attackers borrow millions instantly (no collateral)
- Manipulate prices in DEXs
- Trigger unfair liquidations
- Repay loan - all in ONE transaction
- Victims lose everything in seconds

**Examples:**
- Cream Finance: $130M stolen
- Euler Finance: $197M stolen
- Mango Markets: $116M stolen

---

## Our Solution 🛡️

```
┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Blockchain  │────▶│  AI Agent   │────▶│  Protection  │
│   Events     │     │  (Gemini)   │     │   Actions    │
└──────────────┘     └─────────────┘     └──────────────┘
```

1. **Monitor** - Agent watches blockchain 24/7
2. **Detect** - Gemini LLM analyzes price deviations
3. **Protect** - Automatically blocks unfair liquidations

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| AI Brain | Google Gemini 2.0 Flash |
| Agent | Python + Web3.py |
| Contracts | Solidity + Hardhat |
| Backend | FastAPI |
| Frontend | React + Vite |
| Blockchain | Ethereum Sepolia |

---

## Key Features

✅ **Real-time Detection** - Catches attacks in < 3 seconds  
✅ **AI-Powered Analysis** - Gemini LLM explains every decision  
✅ **Autonomous Protection** - No human intervention needed  
✅ **Live Dashboard** - Watch AI reasoning in real-time  
✅ **Simulation Mode** - Demo attacks safely on testnet  

---

## Demo Flow

1. **Start** → Dashboard shows healthy system ($2000 ETH)
2. **Attack** → Click "Simulate Attack" button
3. **Watch** → Price crashes, Gemini detects threat
4. **Protect** → Agent blocks liquidations automatically
5. **Reset** → Click "Reset AMM" to restore

---

## Real-World Impact

| Without AMEN | With AMEN |
|--------------|-----------|
| Attack succeeds | Attack blocked |
| Users liquidated unfairly | Users protected |
| Millions lost | Funds safe |
| Protocol reputation damaged | Trust maintained |

---

## Files Created/Modified

### Smart Contracts (`/contracts`)
- `MockWETH.sol` - Test ETH token
- `MockUSDC.sol` - Test USD token
- `PriceOracle.sol` - Price feed
- `SimpleAMM.sol` - DEX (attack target)
- `LendingVault.sol` - Protected lending protocol

### AI Agent (`/agent`)
- `main.py` - Continuous monitoring loop
- `config.py` - Contract addresses & settings

### Backend (`/backend`)
- `main.py` - FastAPI server with threat/action tracking

### Frontend (`/frontend`)
- `App.tsx` - Dashboard with:
  - Price charts
  - Live Gemini LLM feed
  - Threat timeline
  - Control buttons

---

## Why This Matters

**Traditional Security**: Reactive - detect after damage done  
**AMEN Security**: Proactive - prevent damage before it happens

The key innovation is using an LLM not just for analysis, but for **autonomous decision-making** that directly protects user funds on the blockchain.

---

## Run the Demo

```bash
# Terminal 1 - Backend
cd backend && python main.py

# Terminal 2 - Frontend  
cd frontend && npm run dev

# Terminal 3 - Agent
cd agent && python main.py

# Open http://localhost:3001
```

---

*Built for Google AI Hackathon 2026*
