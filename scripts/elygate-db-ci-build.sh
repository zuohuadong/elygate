#!/bin/bash
set -x

export DEBIAN_FRONTEND=noninteractive
export PG_VERSION=18
export PGDATA=/opt/elygate/db-backup

log() {
    echo "[elygate-db-build] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# 1. Start systemd in background to simulate a real boot environment
log "Starting systemd locally for CI build..."
/lib/systemd/systemd &
SYSTEMD_PID=$!
sleep 5

# 2. Run Ansible deploy.yml
log "Executing Pigsty deploy.yml to initialize database..."
cd /root/pigsty
if ! ./deploy.yml; then
    log "ERROR: deploy.yml failed."
    exit 1
fi
log "Pigsty deploy.yml succeeded."

# 3. Wait for PostgreSQL to become available
log "Waiting for PostgreSQL to become ready..."
DB_USER="dbuser_dba"
DB_NAME="postgres"
until su - postgres -c "pg_isready -U $DB_USER -d $DB_NAME"; do
    log "PostgreSQL is not ready yet. Sleeping for 2s..."
    sleep 2
done

# 4. Execute the init.sql script
SQL_FILE="/opt/elygate/init.sql"
log "PostgreSQL is ready! Executing initialization script..."
if [ -f "$SQL_FILE" ]; then
    if su - postgres -c "psql -U $DB_USER -d $DB_NAME -f $SQL_FILE"; then
        log "Initialization script executed successfully."
    else
        log "ERROR: Failed to execute $SQL_FILE"
        exit 1
    fi
else
    log "ERROR: SQL file $SQL_FILE not found!"
    exit 1
fi

# 5. Backup the fully initialized data directory
log "Backing up initialized /data to /opt/elygate/db-backup..."
mkdir -p /opt/elygate/db-backup
rsync -a /data/ /opt/elygate/db-backup/
touch /opt/elygate/db-backup/.elygate-db-baked

# 6. Cleanup and shutdown
log "Stopping systemd..."
kill -TERM $SYSTEMD_PID
wait $SYSTEMD_PID || true

log "CI Build script completed successfully."
exit 0
