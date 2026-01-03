# AMEN - Quick Reference Card

## 🚀 Quick Start Commands

### Deploy Everything
```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your keys

# 2. Deploy contracts (get addresses)
cd contracts && npm install
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat run scripts/setup-agent.js --network sepolia

# 3. Update .env with contract addresses

# 4. Start backend
cd ../backend && pip install -r requirements.txt
uvicorn main:app --reload

# 5. Start agent (new terminal)
cd ../agent && pip install -r requirements.txt
python main.py

# 6. Start frontend (new terminal)
cd ../frontend && npm install
npm run dev
```

## 🔑 Required API Keys

| Key | Where to Get | Free Tier |
|-----|-------------|-----------|
| **SEPOLIA_RPC_URL** | [Alchemy](https://alchemy.com) / [Infura](https://infura.io) | ✅ Yes |
| **GEMINI_API_KEY** | [Google AI Studio](https://makersuite.google.com/app/apikey) | ✅ 1500 req/day |
| **Sepolia ETH** | [Faucets](https://sepoliafaucet.com/) | ✅ Free |
| **Private Keys** | MetaMask (create new wallets) | ✅ Free |

## 📊 LLM Cost Safety

### When LLM is Called ✅
- Price deviation >5%
- Multiple oracle updates same block
- Multiple large swaps (>10 WETH)
- Same-block price recovery
- Liquidation during price drop
- Extreme price change (>10%)

### When LLM is NOT Called ❌
- Every block/cycle
- Normal price movements
- Single small swaps
- Expected user activity
- Already analyzed events

### Efficiency Targets
- **Good**: >50:1 blocks per LLM call
- **Excellent**: >100:1 blocks per LLM call
- **Normal operation**: 100+ blocks per call
- **Under attack**: 10-20 blocks per call

### Cost Estimate
- **Normal**: ~$20/month (or FREE with free tier)
- **Under attack**: ~$200/month
- **Per call**: ~$0.009

## 🎯 Agent Commands

```bash
# Start agent
cd agent && python main.py

# Expected output:
✅ No anomalies - skipping LLM        # Normal operation
🚨 Anomaly detected: Large deviation  # Threat found
🤖 CALLING GEMINI LLM                # LLM invoked
✅ Threat assessment completed        # Analysis done

# Shutdown: Ctrl+C
📊 Session Summary
LLM Calls: 5
Blocks Processed: 500
Efficiency: 100.0 blocks/call
```

## 🧪 Test Attack Detection

```bash
# Terminal 1: Start agent
cd agent && python main.py

# Terminal 2: Run attack
cd scripts && node attack-simulation.js

# Expected:
# 1. Agent detects anomaly
# 2. Calls LLM (ONCE)
# 3. Pauses protocol
# 4. Attack fails
# 5. Dashboard shows event
```

## 📁 Key Files

| File | Purpose |
|------|---------|
| `contracts/src/lending/LendingVault.sol` | Main protocol (pause, liquidation) |
| `agent/main.py` | Agent main loop |
| `agent/reasoner.py` | LLM logic + cost safety |
| `agent/observer.py` | On-chain data collection |
| `backend/main.py` | REST API + WebSocket |
| `frontend/src/App.tsx` | Dashboard UI |

## 🐛 Troubleshooting

### "Insufficient funds"
```bash
# Get Sepolia ETH from faucet
# https://sepoliafaucet.com/
```

### "Invalid RPC URL"
```bash
# Test connection
curl -X POST $SEPOLIA_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### "Agent not authorized"
```bash
cd contracts
npx hardhat run scripts/setup-agent.js --network sepolia
```

### "Frontend shows network error"
```bash
# Check backend is running on port 8000
curl http://localhost:8000/health

# Check frontend .env
cat frontend/.env
# Should have:
# VITE_API_URL=http://localhost:8000
# VITE_WS_URL=ws://localhost:8000
```

### "Too many LLM calls"
```bash
# Check efficiency ratio (should be >50:1)
# Look for: "Efficiency: X blocks/call" in shutdown summary

# If too low (<20:1), increase thresholds:
export PRICE_DEVIATION_THRESHOLD=0.07  # 7%
```

## 📊 Dashboard URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | http://localhost:5173 | Main dashboard |
| **Backend** | http://localhost:8000 | API |
| **API Docs** | http://localhost:8000/docs | Swagger UI |
| **Health Check** | http://localhost:8000/health | Status |

## 🔐 Security Checklist

- [ ] Created NEW testnet wallets (never use mainnet)
- [ ] Stored private keys in `.env` (not committed to git)
- [ ] Got Sepolia ETH for deployer wallet
- [ ] Got Sepolia ETH for agent wallet
- [ ] Deployed contracts to Sepolia
- [ ] Ran setup-agent.js to authorize agent
- [ ] Verified contract addresses in all .env files
- [ ] Backend CORS configured for frontend URL
- [ ] LLM API key is valid and has quota

## 📚 Documentation

| Document | Contents |
|----------|----------|
| [README.md](./README.md) | Project overview |
| [SETUP.md](./SETUP.md) | Complete deployment guide |
| [LLM_COST_SAFETY.md](./LLM_COST_SAFETY.md) | Cost optimization details |
| [ENV_GUIDE.md](./ENV_GUIDE.md) | Environment variables |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Technical details |

## 🎓 Architecture (Simplified)

```
Sepolia Blockchain
    ↓ (Web3.py)
Python Agent → Gemini LLM → Policy Decision → Transaction
    ↓ (HTTP)
FastAPI Backend
    ↓ (WebSocket)
React Dashboard
```

## 💡 Pro Tips

1. **Monitor efficiency**: Good ratio = lower costs
2. **Use faucets**: Sepolia ETH is free, refill as needed
3. **Check logs**: Agent logs show anomaly detection
4. **Dashboard first**: Verify backend running before debugging
5. **Test attack**: Run simulation to see agent in action
6. **Read docs**: LLM_COST_SAFETY.md explains efficiency

## 🚨 Emergency Procedures

### Agent Stopped Working
```bash
# Check logs for errors
cd agent
python main.py
# Look for connection errors, RPC issues, etc.
```

### Protocol Stuck in Paused State
```bash
# Manually unpause (as deployer)
npx hardhat console --network sepolia
> const vault = await ethers.getContractAt("LendingVault", "0x...")
> await vault.unpause()
```

### Reset Everything
```bash
# Redeploy contracts
cd contracts
npx hardhat run scripts/deploy.js --network sepolia

# Update all .env files with new addresses
# Restart agent and backend
```

## ✅ Success Indicators

- Agent logs show "No anomalies - skipping LLM" (normal)
- Efficiency ratio >50:1
- Dashboard shows live price updates
- Attack simulation triggers agent response
- LLM called only when anomalies detected
- No rate limit errors

---

**AMEN: Protecting DeFi, efficiently.**

**📖 For detailed info, see [SETUP.md](./SETUP.md) and [LLM_COST_SAFETY.md](./LLM_COST_SAFETY.md)**
