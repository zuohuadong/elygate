#!/bin/bash
# Fix admin user password hash in Elygate database
# Root cause: the hash in init.sql was truncated/invalid,
# causing Bun.password.verify to throw PASSWORD_UNSUPPORTED_ALGORITHM
# This replaces it with a valid argon2id hash for password: admin123

CONTAINER="elygate-db"
DB_USER="dbuser_dba"
DB_NAME="postgres"

NEW_HASH='$argon2id$v=19$m=65536,t=2,p=1$YV3wTB83V0mMIG8xiW2/H4S7fEsz2nxAdFTvBjrIdgI$iJsslt6xW+TqGL+tOwDLxWT0ncdcM4wzogJJz2ppnTY'

echo "=== Patching admin password hash in container: $CONTAINER ==="
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "UPDATE users SET password_hash = '$NEW_HASH' WHERE username = 'admin';"

echo "=== Done. Admin login: admin / admin123 ==="
