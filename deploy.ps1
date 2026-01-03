#!/usr/bin/env pwsh
# Deploy AMEN to Google Cloud Run

Write-Host "🚀 Deploying AMEN to Google Cloud Run..." -ForegroundColor Cyan

# Set your Google Cloud project ID
$PROJECT_ID = Read-Host "Enter your Google Cloud Project ID"
$REGION = "us-central1"

Write-Host "`n📦 Setting up Google Cloud project..." -ForegroundColor Yellow
gcloud config set project $PROJECT_ID

# Enable required APIs
Write-Host "`n🔧 Enabling Cloud Run and Container Registry APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Build and deploy backend
Write-Host "`n🔨 Building and deploying backend..." -ForegroundColor Yellow
Set-Location backend
gcloud builds submit --tag gcr.io/$PROJECT_ID/amen-backend
gcloud run deploy amen-backend `
    --image gcr.io/$PROJECT_ID/amen-backend `
    --platform managed `
    --region $REGION `
    --allow-unauthenticated `
    --set-env-vars "RPC_URL=https://eth-sepolia.g.alchemy.com/v2/DsAGO4co8iV4lmwiZYHW8,PRIVATE_KEY=51a987387d54ac66224c321a06bcc389cfeb6627c13badda66d32008ac42c244" `
    --memory 512Mi `
    --timeout 300

$BACKEND_URL = gcloud run services describe amen-backend --platform managed --region $REGION --format 'value(status.url)'
Write-Host "✅ Backend deployed at: $BACKEND_URL" -ForegroundColor Green

# Build and deploy agent
Write-Host "`n🔨 Building and deploying agent..." -ForegroundColor Yellow
Set-Location ../agent
gcloud builds submit --tag gcr.io/$PROJECT_ID/amen-agent
gcloud run deploy amen-agent `
    --image gcr.io/$PROJECT_ID/amen-agent `
    --platform managed `
    --region $REGION `
    --no-allow-unauthenticated `
    --set-env-vars "GOOGLE_API_KEY=AIzaSyByNyK9Jmi3HV_YlLu4VlMIrhxipThDvzw,RPC_URL=https://eth-sepolia.g.alchemy.com/v2/DsAGO4co8iV4lmwiZYHW8,PRIVATE_KEY=51a987387d54ac66224c321a06bcc389cfeb6627c13badda66d32008ac42c244,BACKEND_URL=$BACKEND_URL" `
    --memory 512Mi `
    --cpu 1 `
    --min-instances 1

Write-Host "✅ Agent deployed" -ForegroundColor Green

# Build and deploy frontend
Write-Host "`n🔨 Building and deploying frontend..." -ForegroundColor Yellow
Set-Location ../frontend

# Update frontend API URL
$envContent = "VITE_API_URL=$BACKEND_URL"
Set-Content -Path ".env.production" -Value $envContent

gcloud builds submit --tag gcr.io/$PROJECT_ID/amen-frontend
gcloud run deploy amen-frontend `
    --image gcr.io/$PROJECT_ID/amen-frontend `
    --platform managed `
    --region $REGION `
    --allow-unauthenticated `
    --memory 256Mi

$FRONTEND_URL = gcloud run services describe amen-frontend --platform managed --region $REGION --format 'value(status.url)'
Write-Host "✅ Frontend deployed at: $FRONTEND_URL" -ForegroundColor Green

Write-Host "`n🎉 Deployment Complete!" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Frontend: $FRONTEND_URL" -ForegroundColor White
Write-Host "Backend:  $BACKEND_URL" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

Set-Location ..
