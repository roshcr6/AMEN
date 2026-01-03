# AMEN - Google Cloud Run Deployment Guide

## Prerequisites
1. Google Cloud account with billing enabled
2. gcloud CLI installed: https://cloud.google.com/sdk/docs/install
3. Docker Desktop (optional, for local testing)

---

## Quick Deploy (3 Commands)

### Step 1: Login & Set Project
```powershell
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
```

### Step 2: Deploy Backend
```powershell
cd "c:\Users\lenovo\OneDrive\Desktop\AMEN\backend"

gcloud run deploy amen-backend `
  --source . `
  --region us-central1 `
  --allow-unauthenticated `
  --port 8080 `
  --memory 512Mi `
  --set-env-vars "CORS_ORIGINS=*"
```

📝 **Copy the URL** it gives you (e.g., `https://amen-backend-xxxxx-uc.a.run.app`)

### Step 3: Deploy Frontend
```powershell
cd "c:\Users\lenovo\OneDrive\Desktop\AMEN\frontend"

# Create production environment file
@"
VITE_API_URL=https://amen-backend-xxxxx-uc.a.run.app
VITE_WS_URL=wss://amen-backend-xxxxx-uc.a.run.app/ws
"@ | Out-File -FilePath ".env.production" -Encoding utf8

# Build and deploy
npm run build

gcloud run deploy amen-frontend `
  --source . `
  --region us-central1 `
  --allow-unauthenticated `
  --port 80 `
  --memory 256Mi
```

### Step 4: Deploy Agent (Runs 24/7)
```powershell
cd "c:\Users\lenovo\OneDrive\Desktop\AMEN\agent"

gcloud run deploy amen-agent `
  --source . `
  --region us-central1 `
  --no-allow-unauthenticated `
  --memory 512Mi `
  --min-instances 1 `
  --max-instances 1 `
  --timeout 3600 `
  --set-env-vars "BACKEND_URL=https://amen-backend-xxxxx-uc.a.run.app,SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY,GEMINI_API_KEY=YOUR_KEY,AGENT_PRIVATE_KEY=YOUR_KEY,WETH_ADDRESS=0x7E8c42a6F66c2225015FDFf0814D7c1BaCc4A9d2,USDC_ADDRESS=0xd333C2bfD3780Cb9eaf1a21B3EA856cBbf8479E1,AMM_ADDRESS=0x0Db2401DA9810F7f1023D8df8D52328E3A0f92Cd,LENDING_VAULT_ADDRESS=0x09aEaE5751AFbc19A20f75eFd63B7431c094224c,ORACLE_ADDRESS=0x0b939bbab85d69A27df77b45c1e5b7E8B5FB3D3f"
```

---

## Environment Variables Reference

### Backend
| Variable | Description |
|----------|-------------|
| CORS_ORIGINS | Allowed origins (use `*` or frontend URL) |
| DATABASE_URL | SQLite path (default: ./amen_security.db) |

### Agent (Required)
| Variable | Value |
|----------|-------|
| SEPOLIA_RPC_URL | `https://eth-sepolia.g.alchemy.com/v2/DsAGO4co8iV4lmwiZYHW8` |
| AGENT_PRIVATE_KEY | `51a987387d54ac66224c321a06bcc389cfeb6627c13badda66d32008ac42c244` |
| GEMINI_API_KEY | Your Gemini API key |
| BACKEND_URL | Your deployed backend URL |
| WETH_ADDRESS | `0x7E8c42a6F66c2225015FDFf0814D7c1BaCc4A9d2` |
| USDC_ADDRESS | `0xd333C2bfD3780Cb9eaf1a21B3EA856cBbf8479E1` |
| AMM_ADDRESS | `0x0Db2401DA9810F7f1023D8df8D52328E3A0f92Cd` |
| LENDING_VAULT_ADDRESS | `0x09aEaE5751AFbc19A20f75eFd63B7431c094224c` |
| ORACLE_ADDRESS | `0x0b939bbab85d69A27df77b45c1e5b7E8B5FB3D3f` |

---

## Cost Estimate

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| Frontend | min-instances=0, scales to zero | ~$0 (free tier) |
| Backend | min-instances=0, scales to zero | ~$0 (free tier) |
| Agent | min-instances=1 (always on) | ~$5-10/month |

**Total: ~$5-10/month**

---

## Troubleshooting

### View Logs
```powershell
gcloud run services logs read amen-backend --region us-central1
gcloud run services logs read amen-agent --region us-central1
```

### Update Environment Variables
```powershell
gcloud run services update amen-agent --region us-central1 `
  --set-env-vars "NEW_VAR=value"
```

### Delete Services
```powershell
gcloud run services delete amen-backend --region us-central1
gcloud run services delete amen-frontend --region us-central1
gcloud run services delete amen-agent --region us-central1
```

---

## WebSocket Note

Cloud Run supports WebSockets but requires:
1. HTTP/2 enabled (default)
2. Client reconnection logic (already implemented in frontend)

If WebSocket issues occur, the frontend falls back to polling (every 2 seconds).
