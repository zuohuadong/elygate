#!/bin/bash

# Elygate Deployment Script
# Deploy Elygate with existing Pigsty PostgreSQL

set -e

echo "🚀 Elygate Deployment Script"
echo "============================"

# Configuration
DEPLOY_DIR="/opt/elygate"
SERVER="elygate"
ADMIN_PASSWORD="zz123qwe"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# ============================================================
# Step 1: Sync project files
# ============================================================
echo ""
echo "📦 Step 1: Syncing project files..."

rsync -avz --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'bun.lock' \
    --exclude '*.log' \
    --exclude '.env' \
    ./ ${SERVER}:${DEPLOY_DIR}/

print_success "Project files synced"

# ============================================================
# Step 2: Create environment file
# ============================================================
echo ""
echo "⚙️  Step 2: Creating environment configuration..."

ssh ${SERVER} "cat > ${DEPLOY_DIR}/.env << 'EOF'
# Elygate Production Configuration

# Database (using Pigsty PostgreSQL 18.3)
DATABASE_URL=postgresql://dbuser_dba:efl62UnYeByXDTjsNjsMQ9vb3Wx0z4dp@localhost:5432/postgres

# Connection Pool
DB_POOL_SIZE=20
DB_IDLE_TIMEOUT=30
DB_CONNECT_TIMEOUT=10
DB_MAX_LIFETIME=1800
DB_MAX_PIPELINE=200

# Application
PORT=3000
NODE_ENV=production

# Security
JWT_SECRET=elygate-jwt-secret-2026-production-$(openssl rand -hex 32)
BETTER_AUTH_SECRET=elygate-auth-secret-2026-$(openssl rand -hex 32)

# Admin Password
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Semantic Cache
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_THRESHOLD=0.95
SEMANTIC_CACHE_TTL_HOURS=24

# Logging
LOG_RETENTION_DAYS=7
LOG_LEVEL=info
REQUEST_LOGGING=true

# Rate Limiting
DEFAULT_RATE_LIMIT=300
RATE_LIMIT_WINDOW=60000

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=3
HEALTH_CHECK_INTERVAL=60000

# Performance
MAX_CONCURRENT_REQUESTS=100
REQUEST_TIMEOUT=30000
STREAM_BUFFER_SIZE=64

# Monitoring
MONITORING_ENABLED=true
API_DOCS_ENABLED=true
EOF"

print_success "Environment configuration created"

# ============================================================
# Step 3: Install dependencies
# ============================================================
echo ""
echo "📦 Step 3: Installing dependencies..."

ssh ${SERVER} "cd ${DEPLOY_DIR} && source ~/.bash_profile && bun install"

print_success "Dependencies installed"

# ============================================================
# Step 4: Build project
# ============================================================
echo ""
echo "🔨 Step 4: Building project..."

ssh ${SERVER} "cd ${DEPLOY_DIR}/apps/admin && source ~/.bash_profile && bun install && bun run build"

print_success "Project built successfully"

# ============================================================
# Step 5: Initialize database
# ============================================================
echo ""
echo "🗄️  Step 5: Initializing database..."

ssh ${SERVER} "cd ${DEPLOY_DIR} && source ~/.bash_profile && sudo -u postgres psql -f packages/db/src/init.sql 2>/dev/null || echo 'Database already initialized'"

print_success "Database initialized"

# ============================================================
# Step 6: Create systemd service
# ============================================================
echo ""
echo "🔧 Step 6: Creating systemd service..."

ssh ${SERVER} "cat > /etc/systemd/system/elygate.service << 'EOF'
[Unit]
Description=Elygate AI API Gateway
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${DEPLOY_DIR}
Environment=\"NODE_ENV=production\"
Environment=\"PATH=/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"
ExecStart=/root/.bun/bin/bun run apps/gateway/src/index.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=elygate

[Install]
WantedBy=multi-user.target
EOF"

ssh ${SERVER} "systemctl daemon-reload"

print_success "Systemd service created"

# ============================================================
# Step 7: Start Elygate
# ============================================================
echo ""
echo "🚀 Step 7: Starting Elygate..."

ssh ${SERVER} "systemctl enable elygate && systemctl start elygate && sleep 3 && systemctl status elygate | head -15"

print_success "Elygate started successfully"

# ============================================================
# Step 8: Verify deployment
# ============================================================
echo ""
echo "🔍 Step 8: Verifying deployment..."

ssh ${SERVER} "curl -s http://localhost:3000/health || echo 'Health check failed'"

print_success "Deployment verification completed"

# ============================================================
# Summary
# ============================================================
echo ""
echo "✅ Elygate Deployment Complete!"
echo "==============================="
echo ""
echo "📝 Configuration:"
echo "   - Database: Pigsty PostgreSQL 18.3"
echo "   - Port: 3000"
echo "   - Admin Password: ${ADMIN_PASSWORD}"
echo "   - Environment: Production"
echo ""
echo "🌐 Access URLs:"
echo "   - HTTP:  http://5.78.65.161"
echo "   - HTTPS: https://api.elygate.com (after DNS configuration)"
echo "   - Admin:  https://api.elygate.com/admin"
echo ""
echo "🔧 Management Commands:"
echo "   - Status:   ssh ${SERVER} 'systemctl status elygate'"
echo "   - Logs:     ssh ${SERVER} 'journalctl -u elygate -f'"
echo "   - Restart:  ssh ${SERVER} 'systemctl restart elygate'"
echo "   - Stop:     ssh ${SERVER} 'systemctl stop elygate'"
echo ""
print_success "Deployment completed successfully!"
