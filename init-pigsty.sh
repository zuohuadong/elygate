#!/bin/bash
set -e

echo "=== Installing PostgreSQL 17 ==="
pig install pg17 -y

echo "=== Adding pigsty repo ==="
pig repo add pigsty -u

echo "=== Installing extensions ==="
pig install pgvector pg_cron pg_bigm -v 17 -y

echo "=== Configuring PostgreSQL ==="
cat > /etc/postgresql/17/main/postgresql.conf << 'PGCONF'
data_directory = '/var/lib/postgresql/17/main'
hba_file = '/etc/postgresql/17/main/pg_hba.conf'
listen_addresses = '*'
port = 5432
max_connections = 100
shared_buffers = 128MB
shared_preload_libraries = pg_cron
cron.database_name = postgres
PGCONF

cat > /etc/postgresql/17/main/pg_hba.conf << 'HBACONF'
local all all trust
host all all 127.0.0.1/32 trust
host all all 0.0.0.0/0 md5
host all all ::1/128 trust
HBACONF

chown postgres:postgres /etc/postgresql/17/main/postgresql.conf
chown postgres:postgres /etc/postgresql/17/main/pg_hba.conf

echo "=== Starting PostgreSQL ==="
pg_ctlcluster 17 main start
sleep 3

echo "=== Creating user and initializing database ==="
psql -U postgres -c "CREATE USER dbuser_dba WITH SUPERUSER PASSWORD 'DBUser.DBA';"
psql -U postgres -f /docker-entrypoint-initdb.d/init.sql

echo "=== PostgreSQL initialization complete ==="
pg_isready
