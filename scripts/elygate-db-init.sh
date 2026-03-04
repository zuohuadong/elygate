#!/bin/bash
set -eo pipefail

DB_USER="dbuser_dba"
DB_NAME="postgres"
SQL_FILE="/opt/elygate/init.sql"
MARKER_FILE="/data/.elygate-db-initialized"

log() {
    echo "[elygate-db-init] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

if [ -f "$MARKER_FILE" ]; then
    log "Database already initialized (marker found). Exiting."
    exit 0
fi

log "Waiting for PostgreSQL to become available..."
until pg_isready -U "$DB_USER" -d "$DB_NAME"; do
    log "PostgreSQL is not ready yet. Sleeping for 2s..."
    sleep 2
done

log "PostgreSQL is ready! Executing initialization script..."
if [ -f "$SQL_FILE" ]; then
    psql -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE"
    
    log "Initialization script executed successfully."
    touch "$MARKER_FILE"
    log "Marker file created. Initialization complete."
else
    log "ERROR: SQL file $SQL_FILE not found!"
    exit 1
fi
