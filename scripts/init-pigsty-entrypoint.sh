#!/bin/bash
set -e

DATA_DIR="/var/lib/postgresql/18/main"

if [ ! -d "$DATA_DIR/base" ]; then
    echo "=== Initializing PostgreSQL data directory ==="
    pg_ctlcluster 18 main start || true
    sleep 3
    
    echo "=== Creating user and database ==="
    psql -U postgres -c "CREATE USER dbuser_dba WITH SUPERUSER PASSWORD 'DBUser.DBA';" || true
    
    echo "=== Running init.sql ==="
    if [ -f /docker-entrypoint-initdb.d/init.sql ]; then
        psql -U postgres -f /docker-entrypoint-initdb.d/init.sql
    fi
    
    echo "=== Stopping PostgreSQL ==="
    pg_ctlcluster 18 main stop
fi

echo "=== Starting PostgreSQL ==="
exec pg_ctlcluster 18 main start -o "-c listen_addresses='*'"
