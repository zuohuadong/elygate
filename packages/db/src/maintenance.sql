-- Elygate Production Maintenance Script

-- 1. Log Retention Policy (Delete logs older than 90 days)
CREATE OR REPLACE PROCEDURE cleanup_old_logs(retention_days INTEGER DEFAULT 90)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Delete log details first (foreign key)
    DELETE FROM log_details
    WHERE log_created_at < NOW() - (retention_days || ' days')::INTERVAL;

    -- Delete main logs
    DELETE FROM logs
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;

    RAISE NOTICE 'Cleaned up logs older than % days.', retention_days;
END;
$$;

-- 2. Schedule via pg_cron (if available)
-- SELECT cron.schedule('cleanup-logs', '0 2 * * *', 'CALL cleanup_old_logs(90)');

-- 3. Optimization
CREATE OR REPLACE PROCEDURE optimize_tables()
LANGUAGE plpgsql
AS $$
BEGIN
    VACUUM ANALYZE logs;
    VACUUM ANALYZE log_details;
    VACUUM ANALYZE organizations;
    VACUUM ANALYZE users;
END;
$$;
