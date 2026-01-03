# AMEN Complete Setup Guide

## Agentic Manipulation Engine Neutralizer - Step-by-Step Deployment

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Detailed Setup](#detailed-setup)
4. [Contract Deployment](#contract-deployment)
5. [Agent Configuration](#agent-configuration)
6. [Backend Setup](#backend-setup)
7. [Frontend Setup](#frontend-setup)
8. [Testing](#testing)
9. [Cloud Deployment](#cloud-deployment)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18.x+ | Smart contracts & scripts |
| Python | 3.10+ | AI agent |
| Git | Latest | Version control |
| Docker | 24.x+ | Containerization (optional) |

### Required Accounts & Keys

1. **Ethereum Wallet**: MetaMask or similar
2. **Alchemy Account**: For Sepolia RPC (free tier works)
3. **Google AI Studio**: For Gemini API key (free tier available)
4. **Sepolia ETH**: Get from faucets

### Sepolia ETH Faucets

- [Alchemy Faucet](https://sepoliafaucet.com/) (requires Alchemy account)
- [Infura Faucet](https://www.infura.io/faucet/sepolia)
- [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

---

## Quick Start

```bash
# 1. Clone and enter directory
cd AMEN

# 2. Copy environment file
cp .env.example .env
# Edit .env with your keys (see Environment Setup section)

# 3. Install all dependencies
cd contracts && npm install && cd ..
cd scripts && npm install && cd ..
cd agent && pip install -r requirements.txt && cd ..
cd backend && pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..

# 4. Deploy contracts
cd contracts
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat run scripts/setup-agent.js --network sepolia
cd ..

# 5. Start services (in separate terminals)
# Terminal 1: Backend
cd backend && uvicorn main:app --reload

# Terminal 2: Agent
cd agent && python main.py

# Terminal 3: Frontend
cd frontend && npm run dev
```

---

## Detailed Setup

### Environment Setup

Create `.env` file in root directory:

```env
# =============================================================================
# BLOCKCHAIN
# =============================================================================
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
CHAIN_ID=11155111

# =============================================================================
# WALLETS (Get private keys from MetaMask - don't use mainnet wallets!)
# =============================================================================
DEPLOYER_PRIVATE_KEY=your_deployer_private_key
AGENT_PRIVATE_KEY=your_agent_private_key
ATTACKER_PRIVATE_KEY=your_attacker_private_key

# =============================================================================
# CONTRACT ADDRESSES (filled after deployment)
# =============================================================================
WETH_ADDRESS=
USDC_ADDRESS=
ORACLE_ADDRESS=
AMM_POOL_ADDRESS=
LENDING_VAULT_ADDRESS=

# =============================================================================
# AI
# =============================================================================
GEMINI_API_KEY=your_gemini_api_key

# =============================================================================
# BACKEND
# =============================================================================
BACKEND_URL=http://localhost:8000
DATABASE_URL=sqlite:///./amen_security.db
```

### Getting Wallet Private Keys

1. Open MetaMask
2. Click three dots → Account Details
3. Click "Show Private Key"
4. Enter password
5. Copy the key (starts with 0x usually)

> ⚠️ **SECURITY**: Create NEW wallets for testnet. Never use wallets with mainnet funds!

### Getting Alchemy API Key

1. Go to [alchemy.com](https://www.alchemy.com/)
2. Create free account
3. Create new app → Select "Ethereum" → "Sepolia"
4. Copy the HTTPS URL

### Getting Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key

---

## Contract Deployment

### Step 1: Install Dependencies

```bash
cd contracts
npm install
```

### Step 2: Configure Hardhat

The `hardhat.config.js` should already be configured. Verify:

```javascript
// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

module.exports = {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
    },
  },
};
```

### Step 3: Deploy Contracts

```bash
# Deploy all contracts
npx hardhat run scripts/deploy.js --network sepolia
```

Expected output:
```
Deploying AMEN Protocol to Sepolia...
Deploying MockWETH...
MockWETH deployed to: 0x...
Deploying MockUSDC...
MockUSDC deployed to: 0x...
Deploying PriceOracle...
PriceOracle deployed to: 0x...
Deploying SimpleAMM...
SimpleAMM deployed to: 0x...
Deploying LendingVault...
LendingVault deployed to: 0x...

=== UPDATE YOUR .env FILE ===
WETH_ADDRESS=0x...
USDC_ADDRESS=0x...
ORACLE_ADDRESS=0x...
AMM_POOL_ADDRESS=0x...
LENDING_VAULT_ADDRESS=0x...
```

### Step 4: Update .env with Addresses

Copy the addresses from deployment output to your `.env` file.

### Step 5: Setup Agent Authorization

```bash
npx hardhat run scripts/setup-agent.js --network sepolia
```

This grants the agent wallet permission to pause/unpause the protocol.

### Step 6: Verify Contracts (Optional)

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## Agent Configuration

### Install Python Dependencies

```bash
cd agent
pip install -r requirements.txt
```

Or using a virtual environment:

```bash
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

pip install -r requirements.txt
```

### Run the Agent

```bash
python main.py
```

Expected output:
```
============================================================
AMEN Security Agent Starting
============================================================
Chain ID: 11155111
RPC URL: https://eth-sepolia.g.alchemy.com/v2/...
Agent Address: 0x...
============================================================

Initializing components...
✓ Observer initialized
✓ Reasoner initialized (Gemini model: gemini-1.5-pro)
✓ Decider initialized
✓ Actor initialized
✓ Reporter initialized

Starting main loop...

=== CYCLE 1 ===
[OBSERVE] Collecting blockchain state...
[REASON] Analyzing with Gemini...
[DECIDE] Evaluating response...
[ACT] No action needed
[REPORT] Sending to backend...
```

### Agent Configuration Options

Edit `agent/config.py` to adjust:

```python
# Polling interval (seconds)
POLL_INTERVAL = 12

# Thresholds
PRICE_DEVIATION_THRESHOLD = 0.05  # 5%
PAUSE_CONFIDENCE_THRESHOLD = 0.75  # 75%
BLOCK_LIQUIDATION_THRESHOLD = 0.60  # 60%
```

---

## Backend Setup

### Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### Run Development Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/prices` | GET | Price history |
| `/api/events` | GET | Security events |
| `/api/reasonings` | GET | Agent reasoning logs |
| `/api/stats` | GET | Protocol statistics |
| `/api/agent/status` | GET | Agent status |
| `/ws` | WebSocket | Real-time updates |

### API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## Frontend Setup

### Install Dependencies

```bash
cd frontend
npm install
```

### Environment Variables

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

### Run Development Server

```bash
npm run dev
```

Visit: http://localhost:5173

### Build for Production

```bash
npm run build
```

Output will be in `frontend/dist/`.

---

## Testing

### Smart Contract Tests

```bash
cd contracts
npx hardhat test
```

### Run Attack Simulation

```bash
cd scripts
node attack-simulation.js
```

This simulates:
1. Flash loan borrow
2. AMM swap to manipulate price
3. Oracle manipulation attempt
4. Unfair liquidation attempt

Watch the agent detect and respond!

### Manual Testing Steps

1. **Deploy & Setup**: Complete contract deployment
2. **Start Services**: Backend, Agent, Frontend
3. **Fund Test Wallets**: Use faucets in contracts
4. **Create Position**: 
   - Deposit WETH as collateral
   - Borrow USDC
5. **Run Attack**: Execute attack simulation
6. **Observe Dashboard**: Watch real-time detection

---

## Cloud Deployment

### Docker Compose (Local)

```bash
cd deploy
docker-compose up --build
```

Services:
- Agent: http://localhost:8080
- Backend: http://localhost:8000
- Frontend: http://localhost:3000

### Google Cloud Run Deployment

#### Prerequisites

1. Google Cloud account with billing enabled
2. `gcloud` CLI installed and configured
3. Docker installed

#### Steps

1. **Setup GCP Project**

```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

2. **Create Artifact Registry**

```bash
gcloud artifacts repositories create amen \
  --repository-format=docker \
  --location=us-central1
```

3. **Store Secrets**

```bash
# Store each secret
echo -n "your_sepolia_rpc_url" | gcloud secrets create SEPOLIA_RPC_URL --data-file=-
echo -n "your_agent_private_key" | gcloud secrets create AGENT_PRIVATE_KEY --data-file=-
echo -n "your_gemini_api_key" | gcloud secrets create GEMINI_API_KEY --data-file=-
# ... repeat for all sensitive values
```

4. **Deploy with Cloud Build**

```bash
cd deploy
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

Or manually trigger:

```bash
gcloud builds submit --config=cloudbuild.yaml ..
```

### Environment Variables for Cloud Run

Set in Cloud Run console or via CLI:

```bash
gcloud run services update amen-agent \
  --set-env-vars="CHAIN_ID=11155111" \
  --set-secrets="SEPOLIA_RPC_URL=SEPOLIA_RPC_URL:latest"
```

---

## Troubleshooting

### Common Issues

#### 1. "Insufficient funds for gas"

**Problem**: Wallet doesn't have Sepolia ETH

**Solution**: 
- Get Sepolia ETH from faucets
- Verify correct wallet address

#### 2. "Invalid private key"

**Problem**: Private key format incorrect

**Solution**:
- Ensure key starts with `0x` or is 64 hex chars
- No spaces or extra characters
- Check for accidentally copied characters

#### 3. "Cannot connect to RPC"

**Problem**: RPC URL invalid or rate limited

**Solution**:
- Verify Alchemy/Infura URL is correct
- Check API key is valid
- Upgrade from free tier if rate limited

#### 4. "Agent not authorized"

**Problem**: Agent wallet not set as security agent

**Solution**:
```bash
cd contracts
npx hardhat run scripts/setup-agent.js --network sepolia
```

#### 5. "Gemini API error"

**Problem**: Invalid API key or quota exceeded

**Solution**:
- Verify API key in Google AI Studio
- Check quota usage
- Ensure correct model name

#### 6. "CORS error in browser"

**Problem**: Backend not configured for frontend origin

**Solution**:
- Add frontend URL to `CORS_ORIGINS` in backend
- Restart backend server

#### 7. "Contract not found at address"

**Problem**: Wrong network or address

**Solution**:
- Verify you're on Sepolia (chain ID 11155111)
- Check contract addresses in `.env`
- Verify deployment was successful

### Debug Commands

```bash
# Check Python version
python --version

# Check Node version
node --version

# Test RPC connection
curl -X POST $SEPOLIA_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check contract deployment
npx hardhat verify --network sepolia $CONTRACT_ADDRESS

# Test Gemini API
python -c "import google.generativeai as genai; genai.configure(api_key='$GEMINI_API_KEY'); print('OK')"
```

### Logs

- **Agent**: Outputs to console, check for `[OBSERVE]`, `[REASON]`, `[DECIDE]`, `[ACT]` stages
- **Backend**: Uvicorn logs to console
- **Frontend**: Browser developer console (F12)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        AMEN Architecture                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Sepolia Blockchain                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ MockWETH │ │ MockUSDC │ │  Oracle  │ │      SimpleAMM     │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘  │
│                      ┌────────────────────┐                      │
│                      │   LendingVault     │                      │
│                      │  (pausable)        │                      │
│                      └────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Web3
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Python AI Agent                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐  │
│  │ Observer │→│ Reasoner │→│ Decider  │→│  Actor   │→│Report │  │
│  │ (Web3)   │ │ (Gemini) │ │ (Policy) │ │ (TX Sig) │ │(HTTP) │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ REST/WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  /api/events  /api/prices  /api/reasonings  /ws          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                    SQLite Database                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/WS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  React Dashboard (Vite)                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Price Charts  │  Event Timeline  │  Agent Reasoning     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### Production Checklist

- [ ] Use hardware wallet for deployer key
- [ ] Rotate agent private key regularly
- [ ] Enable rate limiting on backend
- [ ] Use HTTPS for all endpoints
- [ ] Set up monitoring/alerting
- [ ] Implement proper logging
- [ ] Regular security audits
- [ ] Multi-sig for contract upgrades

### Key Management

- **Never** commit private keys to git
- Use secret managers in production (GCP Secret Manager, AWS Secrets, etc.)
- Consider using hardware security modules (HSM)

---

## Support

For issues:
1. Check [Troubleshooting](#troubleshooting) section
2. Review logs for error messages
3. Verify all environment variables are set
4. Ensure correct network (Sepolia)

---

## License

MIT License - See LICENSE file for details.
