#!/usr/bin/env pwsh
# Quick deployment script - update existing services

Write-Host "🔄 Updating AMEN services on Cloud Run..." -ForegroundColor Cyan

$PROJECT_ID = gcloud config get-value project
$REGION = "us-central1"

# Rebuild and update backend
Write-Host "`n📦 Updating backend..." -ForegroundColor Yellow
Set-Location backend
gcloud builds submit --tag gcr.io/$PROJECT_ID/amen-backend
gcloud run services update amen-backend --image gcr.io/$PROJECT_ID/amen-backend --region $REGION
Write-Host "✅ Backend updated" -ForegroundColor Green

# Rebuild and update agent
Write-Host "`n📦 Updating agent..." -ForegroundColor Yellow
Set-Location ../agent
gcloud builds submit --tag gcr.io/$PROJECT_ID/amen-agent
gcloud run services update amen-agent --image gcr.io/$PROJECT_ID/amen-agent --region $REGION
Write-Host "✅ Agent updated" -ForegroundColor Green

# Rebuild and update frontend
Write-Host "`n📦 Updating frontend..." -ForegroundColor Yellow
Set-Location ../frontend
gcloud builds submit --tag gcr.io/$PROJECT_ID/amen-frontend
gcloud run services update amen-frontend --image gcr.io/$PROJECT_ID/amen-frontend --region $REGION
Write-Host "✅ Frontend updated" -ForegroundColor Green

Write-Host "`n🎉 All services updated!" -ForegroundColor Cyan
Set-Location ..
