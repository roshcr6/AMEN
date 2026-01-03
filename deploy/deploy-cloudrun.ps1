# ============================================================================
# AMEN - Google Cloud Run Deployment Script
# Deploys Frontend, Backend, and Agent to Cloud Run (Serverless)
# ============================================================================

param(
    [string]$ProjectId = "",
    [string]$Region = "us-central1"
)

# Colors for output
function Write-Step { param($msg) Write-Host "`n🚀 $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host "⚠️ $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "❌ $msg" -ForegroundColor Red }

Write-Host @"
╔══════════════════════════════════════════════════════════════╗
║           AMEN - Google Cloud Run Deployment                 ║
║     Agentic Manipulation Engine Neutralizer                  ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Magenta

# Check if gcloud is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Error "gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
}

# Get project ID
if (-not $ProjectId) {
    $ProjectId = gcloud config get-value project 2>$null
    if (-not $ProjectId) {
        $ProjectId = Read-Host "Enter your Google Cloud Project ID"
    }
}

Write-Step "Using Project: $ProjectId, Region: $Region"

# Set project
gcloud config set project $ProjectId

# Enable required APIs
Write-Step "Enabling required Google Cloud APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# Get the root directory
$RootDir = Split-Path -Parent $PSScriptRoot

# ============================================================================
# Deploy Backend
# ============================================================================
Write-Step "Deploying Backend to Cloud Run..."

$BackendUrl = gcloud run deploy amen-backend `
    --source "$RootDir/backend" `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --port 8080 `
    --memory 512Mi `
    --cpu 1 `
    --min-instances 0 `
    --max-instances 10 `
    --set-env-vars "CORS_ORIGINS=*" `
    --format "value(status.url)" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Success "Backend deployed: $BackendUrl"
} else {
    Write-Error "Backend deployment failed"
    Write-Host $BackendUrl
}

# Extract just the URL
$BackendUrl = $BackendUrl | Select-String -Pattern "https://.*" | ForEach-Object { $_.Matches.Value }

# ============================================================================
# Deploy Frontend (needs backend URL)
# ============================================================================
Write-Step "Deploying Frontend to Cloud Run..."

# Build frontend with backend URL
Push-Location "$RootDir/frontend"

# Create .env.production with backend URL
@"
VITE_API_URL=$BackendUrl
VITE_WS_URL=$($BackendUrl -replace 'https://', 'wss://')/ws
"@ | Out-File -FilePath ".env.production" -Encoding utf8

npm install
npm run build

Pop-Location

$FrontendUrl = gcloud run deploy amen-frontend `
    --source "$RootDir/frontend" `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --port 80 `
    --memory 256Mi `
    --cpu 1 `
    --min-instances 0 `
    --max-instances 10 `
    --format "value(status.url)" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Success "Frontend deployed: $FrontendUrl"
} else {
    Write-Error "Frontend deployment failed"
}

# ============================================================================
# Deploy Agent (needs to run continuously)
# ============================================================================
Write-Step "Deploying Agent to Cloud Run..."

# Agent needs min-instances=1 to run continuously
$AgentUrl = gcloud run deploy amen-agent `
    --source "$RootDir/agent" `
    --region $Region `
    --platform managed `
    --no-allow-unauthenticated `
    --memory 512Mi `
    --cpu 1 `
    --min-instances 1 `
    --max-instances 1 `
    --timeout 3600 `
    --set-env-vars "BACKEND_URL=$BackendUrl" `
    --format "value(status.url)" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Success "Agent deployed: $AgentUrl"
} else {
    Write-Warning "Agent deployment may need manual configuration for secrets"
}

# ============================================================================
# Summary
# ============================================================================
Write-Host @"

╔══════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT COMPLETE!                       ║
╚══════════════════════════════════════════════════════════════╝

🌐 Frontend:  $FrontendUrl
🔧 Backend:   $BackendUrl
🤖 Agent:     $AgentUrl

📋 Next Steps:
1. Set up environment variables for the Agent:
   gcloud run services update amen-agent --region $Region \
     --set-env-vars "SEPOLIA_RPC_URL=your_rpc_url" \
     --set-env-vars "AGENT_PRIVATE_KEY=your_key" \
     --set-env-vars "GEMINI_API_KEY=your_gemini_key"

2. Update CORS in backend if needed:
   gcloud run services update amen-backend --region $Region \
     --set-env-vars "CORS_ORIGINS=$FrontendUrl"

3. Visit your dashboard: $FrontendUrl

"@ -ForegroundColor Green
