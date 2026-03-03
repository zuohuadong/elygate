#!/bin/bash
set -e

DATA_DIR="/var/lib/postgresql/18/main"
PG_BIN="/usr/lib/postgresql/18/bin"

if [ ! -d "$DATA_DIR/base" ]; then
    echo "=== Initializing PostgreSQL data directory ==="
    su - postgres -c "$PG_BIN/initdb -D $DATA_DIR"
    
    echo "=== Starting PostgreSQL temporarily ==="
    su - postgres -c "$PG_BIN/pg_ctl -D $DATA_DIR -l /tmp/pg.log start"
    sleep 3
    
    echo "=== Creating user and database ==="
    su - postgres -c "$PG_BIN/psql -c \"CREATE USER dbuser_dba WITH SUPERUSER PASSWORD 'DBUser.DBA';\"" || true
    
    echo "=== Running init.sql ==="
    if [ -f /docker-entrypoint-initdb.d/init.sql ]; then
        su - postgres -c "$PG_BIN/psql -f /docker-entrypoint-initdb.d/init.sql"
    fi
    
    echo "=== Stopping PostgreSQL ==="
    su - postgres -c "$PG_BIN/pg_ctl -D $DATA_DIR stop"
fi

echo "=== Starting PostgreSQL ==="
exec su - postgres -c "$PG_BIN/postgres -D $DATA_DIR"
