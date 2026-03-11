-- Migration script to remove Better Auth tables from the database.
-- Run this script on your PostgreSQL database to clean up the legacy schema.

DROP TABLE IF EXISTS verification CASCADE;
DROP TABLE IF EXISTS account CASCADE;

-- Note: The oauth_accounts, tokens, and session tables are part of the native Elygate implementation and were kept.
