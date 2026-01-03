# AMEN - Agentic Manipulation Engine Neutralizer

## Enterprise-Grade DeFi Security System

AMEN is a production-ready security system that protects DeFi lending protocols from:
- Flash-loan-driven oracle manipulation
- Temporary AMM price distortions  
- Unfair liquidations caused by same-block price attacks

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AMEN SECURITY SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  CONTRACTS  │    │    AGENT    │    │   BACKEND   │    │  FRONTEND   │  │
│  │  (Solidity) │    │  (Python)   │    │  (FastAPI)  │    │   (React)   │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                  │                  │         │
│         ▼                  ▼                  ▼                  ▼         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     SEPOLIA TESTNET (PUBLIC)                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  💰 LLM COST SAFETY: Gemini called ONLY when anomalies detected            │
│     • Block-level deduplication • Event caching • Strict thresholds        │
│     • Expected efficiency: 100+ blocks per LLM call                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### 🛡️ Real-time Protection
- On-chain monitoring every 12 seconds
- Autonomous threat detection and response
- Emergency protocol pause capability

### 🤖 AI-Powered Analysis
- Google Gemini LLM reasoning
- **Cost-optimized**: LLM called only for anomalies (not every block)
- Block-level deduplication prevents duplicate analysis
- Expected efficiency: 100+ blocks per LLM call

### 📊 Live Dashboard
- Real-time price charts
- Threat detection timeline
- Agent reasoning transparency

### ☁️ Cloud-Ready
- Docker containerized
- Google Cloud Run deployment
- Production-grade architecture

## Directory Structure

```
/contracts      → Solidity smart contracts
/agent          → Python AI agent (Gemini-powered)
/backend        → FastAPI REST API + storage
/frontend       → React dashboard
/deploy         → Deployment scripts & configs
/scripts        → Attack simulation & testing
```

## Threat Model

### Defended Against:
1. **Flash-Loan Price Manipulation**: Attacker borrows large capital, manipulates AMM reserves
2. **Oracle Distortion**: Same-block oracle price manipulation
3. **Unfair Liquidations**: Liquidating healthy positions during artificial price dips
4. **Liquidity Imbalance Attacks**: Temporary reserve manipulation for profit

### Detection Signals:
- Price deviation > threshold within single block
- Reserve ratio changes > normal variance
- Same-block price recovery patterns
- Unusual liquidation clustering

## Documentation

- **[SETUP.md](./SETUP.md)** - Complete deployment guide
- **[LLM_COST_SAFETY.md](./LLM_COST_SAFETY.md)** - LLM cost optimization & rate-limit safety
- **[ENV_GUIDE.md](./ENV_GUIDE.md)** - Environment variables reference

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- MetaMask wallet with Sepolia ETH

### Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Fill in your values:
# - SEPOLIA_RPC_URL (Alchemy/Infura)
# - DEPLOYER_PRIVATE_KEY
# - GEMINI_API_KEY
# - AGENT_PRIVATE_KEY
```

### Deploy Contracts
```bash
cd contracts
npm install
npx hardhat compile
npx hardhat run scripts/deploy.js --network sepolia
```

### Start Agent
```bash
cd agent
pip install -r requirements.txt
python main.py
```

### Start Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Start Frontend
```bash
cd frontend
npm install
npm run dev
```

## Security Architecture

### Agent Decision Loop
```
OBSERVE → REASON → DECIDE → ACT → REPORT
   │         │        │       │       │
   │         │        │       │       └─► Log to backend
   │         │        │       └─────────► Execute on-chain action
   │         │        └─────────────────► Apply policy rules
   │         └──────────────────────────► LLM analysis (Gemini)
   └────────────────────────────────────► Collect on-chain data
```

### Policy Rules (Hard-coded)
| Condition | Action |
|-----------|--------|
| FLASH_LOAN_ATTACK && confidence ≥ 0.75 | pause() protocol |
| ORACLE_MANIPULATION | block liquidations |
| Medium confidence (0.5-0.75) | delay + enhanced monitoring |

## License

MIT License - For educational and security research purposes.
