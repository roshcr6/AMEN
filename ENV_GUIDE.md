# AMEN Environment Variables - Quick Reference

## Where to Get Each Key

### 1. Sepolia RPC URL
- **Get from**: [Alchemy](https://www.alchemy.com/) or [Infura](https://www.infura.io/)
- **Steps**: 
  1. Create free account
  2. Create new app → Select "Ethereum" → "Sepolia"
  3. Copy the HTTPS URL
- **Example**: `https://eth-sepolia.g.alchemy.com/v2/abc123...`

### 2. Private Keys (DEPLOYER, AGENT, ATTACKER)
- **Get from**: MetaMask or any Ethereum wallet
- **Steps**:
  1. Open MetaMask
  2. Click 3 dots → Account Details
  3. Click "Show Private Key"
  4. Enter password and copy
- **⚠️ IMPORTANT**: Use NEW wallets for testnet, NEVER use mainnet wallets!
- **Example**: `0xabc123...` (64 hex characters)

### 3. Contract Addresses
- **Get from**: After deploying contracts (see below)
- **Deploy command**: `cd contracts && npx hardhat run scripts/deploy.js --network sepolia`
- **Copy addresses** from deployment output into `.env`

### 4. Gemini API Key
- **Get from**: [Google AI Studio](https://makersuite.google.com/app/apikey)
- **Steps**:
  1. Sign in with Google account
  2. Click "Create API Key"
  3. Copy the key
- **Example**: `AIzaSy...` (starts with AIza)

### 5. Sepolia ETH (for gas)
- **Get from**: Faucets (free testnet ETH)
- **Faucets**:
  - [Alchemy Faucet](https://sepoliafaucet.com/)
  - [Infura Faucet](https://www.infura.io/faucet/sepolia)
  - [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

---

## Required .env Files by Component

### Root Directory: `.env`
**Used by**: Deployment scripts, contract deployment
**Required keys**:
- `SEPOLIA_RPC_URL` - Alchemy/Infura URL
- `DEPLOYER_PRIVATE_KEY` - Wallet to deploy contracts
- `AGENT_PRIVATE_KEY` - Wallet for agent operations
- `ATTACKER_PRIVATE_KEY` - Wallet for attack simulation
- Contract addresses (filled after deployment)

### `agent/.env`
**Used by**: Python AI agent
**Required keys**:
- `SEPOLIA_RPC_URL` - Same as root
- `AGENT_PRIVATE_KEY` - Same as root
- `GEMINI_API_KEY` - Google AI Studio
- All contract addresses
- `BACKEND_URL` - Usually `http://localhost:8000`

### `backend/.env`
**Used by**: FastAPI backend
**Required keys**:
- `DATABASE_URL` - Default: `sqlite:///./amen_security.db`
- `CORS_ORIGINS` - Frontend URLs
- `PORT` - Default: 8000
- `HOST` - Default: 0.0.0.0

### `frontend/.env`
**Used by**: React frontend
**Required keys**:
- `VITE_API_URL` - Backend URL (default: `http://localhost:8000`)
- `VITE_WS_URL` - WebSocket URL (default: `ws://localhost:8000`)

---

## Setup Order

1. **Get API Keys First**
   ```bash
   # Get these before doing anything:
   # - Alchemy/Infura RPC URL
   # - Gemini API key
   # - Create 3 testnet wallets (deployer, agent, attacker)
   ```

2. **Create Root .env**
   ```bash
   cp .env.example .env
   # Fill in: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, AGENT_PRIVATE_KEY, ATTACKER_PRIVATE_KEY, GEMINI_API_KEY
   ```

3. **Get Sepolia ETH**
   ```bash
   # Send Sepolia ETH to your deployer and agent wallet addresses
   # Use faucets listed above
   ```

4. **Deploy Contracts**
   ```bash
   cd contracts
   npm install
   npx hardhat run scripts/deploy.js --network sepolia
   # Copy the 5 contract addresses from output
   ```

5. **Update All .env Files with Contract Addresses**
   ```bash
   # Update root .env
   # Update agent/.env
   ```

6. **Create Component .env Files**
   ```bash
   # Backend
   cp backend/.env.example backend/.env
   
   # Frontend
   cp frontend/.env.example frontend/.env
   
   # Agent
   cp agent/.env.example agent/.env
   # Fill in all values from root .env
   ```

7. **Setup Agent Authorization**
   ```bash
   cd contracts
   npx hardhat run scripts/setup-agent.js --network sepolia
   ```

8. **Start Services**
   ```bash
   # Terminal 1: Backend
   cd backend && pip install -r requirements.txt && uvicorn main:app --reload
   
   # Terminal 2: Agent
   cd agent && pip install -r requirements.txt && python main.py
   
   # Terminal 3: Frontend
   cd frontend && npm install && npm run dev
   ```

---

## Troubleshooting

### "Missing environment variable"
- Check you have the correct `.env` file in the component directory
- Verify the variable name matches exactly (case-sensitive)

### "Invalid RPC URL"
- Test with: `curl -X POST $SEPOLIA_RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
- Should return block number

### "Insufficient funds"
- Get Sepolia ETH from faucets
- Wait a few minutes after requesting

### Frontend shows "Network Error"
- Check backend is running on port 8000
- Verify `VITE_API_URL` matches backend URL
- Check CORS is configured in backend

### Agent can't execute transactions
- Verify agent wallet has Sepolia ETH
- Ensure `setup-agent.js` was run to authorize agent
- Check contract addresses are correct
