#!/bin/bash
set -e

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to start..."
until pg_isready -h localhost -p 5432; do
  sleep 2
done

# Wait a bit more to ensure it's fully accepting connections
sleep 2

# Initialize database using the local init.sql
echo "Initializing Elygate database..."
sudo -u postgres psql -f /opt/elygate/init.sql || echo "Database initialization script finished with some errors (possibly already initialized)"

echo "Database initialization check complete."
