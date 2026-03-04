#!/bin/bash
set -x

DB_USER="dbuser_dba"
DB_NAME="postgres"
SQL_FILE="/opt/elygate/init.sql"
SQL_MARKER="/data/.elygate-db-initialized"
DEPLOY_MARKER="/data/.pigsty-deployed"

log() {
    echo "[elygate-db-init] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# 1. 确保 Pigsty Postgres 已经通过 deploy.yml 安装和拉起
if [ ! -f "$DEPLOY_MARKER" ]; then
    log "Pigsty deploy marker not found. Executing /root/pigsty/deploy.yml ..."
    cd /root/pigsty
    if ./deploy.yml; then
        touch "$DEPLOY_MARKER"
        log "Pigsty deploy.yml execution completed successfully."
    else
        log "ERROR: Pigsty deploy.yml failed."
        exit 1
    fi
else
    log "Pigsty already deployed on this volume ($DEPLOY_MARKER found)."
    # 确保容器重启后 postgresql 启动
    systemctl start postgresql || true
fi

# 2. 等待 Postgres 服务可用
log "Waiting for PostgreSQL to become available..."
until su - postgres -c "pg_isready -U $DB_USER -d $DB_NAME"; do
    log "PostgreSQL is not ready yet. Sleeping for 2s..."
    sleep 2
done

# 3. 执行 init.sql
if [ ! -f "$SQL_MARKER" ]; then
    log "PostgreSQL is ready! Executing initialization script..."
    if [ -f "$SQL_FILE" ]; then
        if su - postgres -c "psql -U $DB_USER -d $DB_NAME -f $SQL_FILE"; then
            log "Initialization script executed successfully."
            touch "$SQL_MARKER"
            log "Marker file created. Initialization complete."
        else
            log "ERROR: Failed to execute $SQL_FILE"
            exit 1
        fi
    else
        log "ERROR: SQL file $SQL_FILE not found!"
        exit 1
    fi
else
    log "Database already initialized ($SQL_MARKER found). Skipping init.sql."
fi

exit 0
