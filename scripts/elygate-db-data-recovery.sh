#!/bin/bash
set -x

BAKED_MARKER="/opt/elygate/db-backup/.elygate-db-baked"
DATA_DIR="/data"
RESTORE_MARKER="/data/.elygate-db-restored"

log() {
    echo "[elygate-db-recovery] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

if [ ! -d "$DATA_DIR" ]; then
    log "ERROR: /data directory does not exist!"
    exit 1
fi

if [ -f "$RESTORE_MARKER" ]; then
    log "Database already restored to volume (marker found). Exiting."
    exit 0
fi

if [ -f "$BAKED_MARKER" ]; then
    log "Found baked data in /opt/elygate/db-backup. Restoring to $DATA_DIR..."
    rsync -a /opt/elygate/db-backup/ $DATA_DIR/
    touch "$RESTORE_MARKER"
    log "Data restoration complete."
else
    log "WARNING: Baked data marker not found. Skipping restore."
fi

exit 0
