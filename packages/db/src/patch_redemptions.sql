-- Fix missing columns in redemptions table (schema alignment with admin.ts and new-api parity)
ALTER TABLE redemptions DROP COLUMN IF EXISTS used_by;
ALTER TABLE redemptions DROP COLUMN IF EXISTS used_at;
ALTER TABLE redemptions DROP COLUMN IF EXISTS code;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Gift';
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS key TEXT NOT NULL UNIQUE DEFAULT 'sk-legacy';
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0;
