DO $$
BEGIN
    IF to_regclass('cron.job') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'semantic-cache-cleanup') THEN
            PERFORM cron.unschedule('semantic-cache-cleanup');
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "semantic_cache";
--> statement-breakpoint
ALTER TABLE "packages" DROP COLUMN IF EXISTS "cache_policy";
--> statement-breakpoint
DELETE FROM "options"
WHERE "key" IN (
    'SemanticCacheEnabled',
    'SemanticCacheThreshold',
    'SemanticCacheTTLHours',
    'SemanticCacheDefaultMode',
    'SemanticCacheEmbeddingModel'
);
