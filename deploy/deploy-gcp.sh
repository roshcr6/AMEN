#!/bin/bash
# =============================================================================
# AMEN - Google Cloud Deployment Script
# =============================================================================
# 
# Prerequisites:
# 1. gcloud CLI installed and authenticated
# 2. Project created: gcloud projects create YOUR_PROJECT_ID
# 3. Billing enabled on the project
# 4. .env file with all required variables
#
# Usage:
#   ./deploy-gcp.sh [PROJECT_ID] [REGION]
#
# Example:
#   ./deploy-gcp.sh my-amen-project us-central1
# =============================================================================

set -e

# Configuration
PROJECT_ID=${1:-$GCP_PROJECT_ID}
REGION=${2:-us-central1}

if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID required"
    echo "Usage: ./deploy-gcp.sh [PROJECT_ID] [REGION]"
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "           AMEN - Google Cloud Deployment                       "
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo ""

# Set project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "📦 Enabling required APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com

# Create Artifact Registry repository
echo "📦 Creating container registry..."
gcloud artifacts repositories create amen-repo \
    --repository-format=docker \
    --location=$REGION \
    --description="AMEN container images" \
    2>/dev/null || echo "Repository already exists"

# Configure Docker for GCP
gcloud auth configure-docker $REGION-docker.pkg.dev --quiet

REGISTRY="$REGION-docker.pkg.dev/$PROJECT_ID/amen-repo"

# =============================================================================
# Build and Push Images
# =============================================================================

echo ""
echo "🔨 Building and pushing images..."

# Backend
echo "Building backend..."
docker build -t $REGISTRY/backend:latest -f deploy/Dockerfile.backend ..
docker push $REGISTRY/backend:latest

# Frontend
echo "Building frontend..."
docker build -t $REGISTRY/frontend:latest -f deploy/Dockerfile.frontend ..
docker push $REGISTRY/frontend:latest

# Agent
echo "Building agent..."
docker build -t $REGISTRY/agent:latest -f deploy/Dockerfile.agent ..
docker push $REGISTRY/agent:latest

# =============================================================================
# Create Secrets
# =============================================================================

echo ""
echo "🔐 Creating secrets..."

# Create secrets from .env file
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue
    
    # Skip if value is a placeholder
    [[ $value == *"your_"* ]] && continue
    [[ -z $value ]] && continue
    
    secret_name=$(echo $key | tr '[:upper:]' '[:lower:]' | tr '_' '-')
    
    echo "  Creating secret: $secret_name"
    echo -n "$value" | gcloud secrets create $secret_name \
        --replication-policy="automatic" \
        --data-file=- 2>/dev/null || \
    echo -n "$value" | gcloud secrets versions add $secret_name --data-file=-
    
done < ../.env

# =============================================================================
# Deploy Services
# =============================================================================

echo ""
echo "🚀 Deploying services..."

# Deploy Backend
echo "Deploying backend..."
gcloud run deploy amen-backend \
    --image=$REGISTRY/backend:latest \
    --region=$REGION \
    --platform=managed \
    --allow-unauthenticated \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=10 \
    --port=8080 \
    --set-env-vars="CORS_ORIGINS=*"

# Get backend URL
BACKEND_URL=$(gcloud run services describe amen-backend --region=$REGION --format='value(status.url)')
echo "Backend URL: $BACKEND_URL"

# Deploy Frontend
echo "Deploying frontend..."
gcloud run deploy amen-frontend \
    --image=$REGISTRY/frontend:latest \
    --region=$REGION \
    --platform=managed \
    --allow-unauthenticated \
    --memory=256Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=5 \
    --port=80 \
    --set-env-vars="VITE_API_URL=$BACKEND_URL"

FRONTEND_URL=$(gcloud run services describe amen-frontend --region=$REGION --format='value(status.url)')

# Deploy Agent (as a Cloud Run Job or always-on service)
echo "Deploying agent..."
gcloud run deploy amen-agent \
    --image=$REGISTRY/agent:latest \
    --region=$REGION \
    --platform=managed \
    --no-allow-unauthenticated \
    --memory=1Gi \
    --cpu=1 \
    --min-instances=1 \
    --max-instances=1 \
    --set-secrets="SEPOLIA_RPC_URL=sepolia-rpc-url:latest" \
    --set-secrets="AGENT_PRIVATE_KEY=agent-private-key:latest" \
    --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
    --set-env-vars="BACKEND_URL=$BACKEND_URL"

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    ✅ Deployment Complete!                     "
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📊 Dashboard:  $FRONTEND_URL"
echo "🔌 Backend:    $BACKEND_URL"
echo "🤖 Agent:      Running on Cloud Run"
echo ""
echo "Next steps:"
echo "  1. Update contract addresses in secrets if not done"
echo "  2. Verify agent is connecting to blockchain"
echo "  3. Monitor logs: gcloud run logs read amen-agent --region=$REGION"
echo ""
