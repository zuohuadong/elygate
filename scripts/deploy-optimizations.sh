#!/bin/bash
# Elygate PostgreSQL 18 Performance Optimization Deployment
set -e

echo "🚀 Starting Elygate Database Optimization..."

# Check environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL is not set."
    exit 1
fi

# 1. Apply Performance Indexes
echo "🔨 Step 1: Applying performance-optimized indexes..."
psql "$DATABASE_URL" -f packages/db/src/performance_indexes.sql

# 2. Optimized PG18 Configurations (Applying to current session and system)
echo "⚙️  Step 2: Tuning PostgreSQL 18 parameters..."
psql "$DATABASE_URL" << 'EOF'
-- Optimization for modern NVMe storage and multicore PG18
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_cache_size = '4GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_workers = 8;
ALTER SYSTEM SET max_parallel_maintenance_workers = 4;
-- IO optimization for PG18 AIO support
ALTER SYSTEM SET effective_io_concurrency = 200;
-- Memory optimization for trgm/vector operations
ALTER SYSTEM SET shared_buffers = '1GB';

SELECT pg_reload_conf();
EOF

echo "✅ Optimization Deployment Complete!"
echo "Note: Some changes may require a database restart to take full effect."
