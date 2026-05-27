import { PgBoss, type Job, type Queue } from 'pg-boss';
import { config } from '../config';
import type { BillingContext } from '../types';
import { getErrorMessage } from '../utils/error';
import { log } from './logger';

export const JOB_QUEUE_NAMES = {
    billingFlush: 'billing.flush',
    webhookDeliver: 'webhook.deliver',
    longTaskProcess: 'long-task.process',
} as const;

export interface WebhookDeliveryJobPayload {
    event: string;
    payload?: Record<string, any>;
    url?: string;
    secret?: string;
    body?: Record<string, any>;
    headers?: Record<string, string>;
    logLabel?: string;
}

export interface LongTaskJobPayload {
    taskId: string;
}

let bossPromise: Promise<PgBoss> | null = null;
let workersPromise: Promise<void> | null = null;

function envNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function ensureQueue(boss: PgBoss, name: string, options: Omit<Queue, 'name'>): Promise<void> {
    await boss.createQueue(name, options);
}

async function ensureQueues(boss: PgBoss): Promise<void> {
    await ensureQueue(boss, JOB_QUEUE_NAMES.billingFlush, {
        partition: true,
        retryLimit: envNumber('PG_BOSS_BILLING_RETRY_LIMIT', 5),
        retryDelay: 1,
        retryBackoff: true,
        expireInSeconds: 300,
        retentionSeconds: 24 * 60 * 60,
        deleteAfterSeconds: 60 * 60,
        warningQueueSize: envNumber('PG_BOSS_BILLING_WARNING_SIZE', 5000),
    });

    await ensureQueue(boss, JOB_QUEUE_NAMES.webhookDeliver, {
        retryLimit: envNumber('PG_BOSS_WEBHOOK_RETRY_LIMIT', 5),
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 30 * 60,
        expireInSeconds: 120,
        retentionSeconds: 7 * 24 * 60 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
        warningQueueSize: envNumber('PG_BOSS_WEBHOOK_WARNING_SIZE', 1000),
    });

    await ensureQueue(boss, JOB_QUEUE_NAMES.longTaskProcess, {
        policy: 'key_strict_fifo',
        retryLimit: envNumber('PG_BOSS_TASK_RETRY_LIMIT', 2),
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 10 * 60,
        expireInSeconds: 60 * 60,
        retentionSeconds: 7 * 24 * 60 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
        heartbeatSeconds: 60,
        warningQueueSize: envNumber('PG_BOSS_TASK_WARNING_SIZE', 1000),
    });
}

async function createBoss(): Promise<PgBoss> {
    const boss = new PgBoss({
        connectionString: config.databaseUrl,
        schema: process.env.PG_BOSS_SCHEMA || 'pgboss',
        max: envNumber('PG_BOSS_POOL_SIZE', 4),
        application_name: process.env.PG_BOSS_APP_NAME || 'elygate-gateway-pgboss',
        monitorIntervalSeconds: envNumber('PG_BOSS_MONITOR_INTERVAL_SECONDS', 60),
        maintenanceIntervalSeconds: envNumber('PG_BOSS_MAINTENANCE_INTERVAL_SECONDS', 24 * 60 * 60),
        queueCacheIntervalSeconds: envNumber('PG_BOSS_QUEUE_CACHE_INTERVAL_SECONDS', 60),
    });

    boss.on('error', (err: unknown) => {
        log.error('[JobQueue] pg-boss error:', getErrorMessage(err));
    });
    boss.on('warning', (warning: unknown) => {
        log.warn('[JobQueue] pg-boss warning:', warning);
    });

    await boss.start();
    await ensureQueues(boss);
    log.info('[JobQueue] pg-boss started');
    return boss;
}

export function getJobQueue(): Promise<PgBoss> {
    if (!bossPromise) {
        bossPromise = createBoss().catch((err) => {
            bossPromise = null;
            throw err;
        });
    }
    return bossPromise;
}

export async function enqueueBillingFlush(payload: BillingContext): Promise<string> {
    const boss = await getJobQueue();
    const jobId = await boss.send(JOB_QUEUE_NAMES.billingFlush, payload);
    if (!jobId) throw new Error('pg-boss did not enqueue billing job');
    return jobId;
}

export async function enqueueWebhookDelivery(payload: WebhookDeliveryJobPayload): Promise<string> {
    const boss = await getJobQueue();
    const jobId = await boss.send(JOB_QUEUE_NAMES.webhookDeliver, payload);
    if (!jobId) throw new Error('pg-boss did not enqueue webhook job');
    return jobId;
}

export async function enqueueLongTask(taskId: string): Promise<string | null> {
    const boss = await getJobQueue();
    const jobId = await boss.send(
        JOB_QUEUE_NAMES.longTaskProcess,
        { taskId } satisfies LongTaskJobPayload,
        {
            singletonKey: taskId,
            singletonSeconds: envNumber('PG_BOSS_TASK_SINGLETON_SECONDS', 24 * 60 * 60),
        }
    );
    return jobId;
}

async function startBillingWorker(boss: PgBoss): Promise<void> {
    await boss.work<BillingContext>(
        JOB_QUEUE_NAMES.billingFlush,
        {
            batchSize: envNumber('PG_BOSS_BILLING_BATCH_SIZE', 100),
            pollingIntervalSeconds: 0.5,
            localConcurrency: 1,
            orderByCreatedOn: false,
        },
        async (jobs: Job<BillingContext>[]) => {
            const { processBillingJobs } = await import('./billing');
            await processBillingJobs(jobs.map((job) => job.data));
            return { processed: jobs.length };
        }
    );
}

async function startWebhookWorker(boss: PgBoss): Promise<void> {
    await boss.work<WebhookDeliveryJobPayload>(
        JOB_QUEUE_NAMES.webhookDeliver,
        {
            batchSize: 1,
            pollingIntervalSeconds: 1,
            localConcurrency: envNumber('PG_BOSS_WEBHOOK_CONCURRENCY', 4),
            orderByCreatedOn: true,
        },
        async (jobs: Job<WebhookDeliveryJobPayload>[]) => {
            const { deliverWebhookJob } = await import('./webhook');
            for (const job of jobs) {
                await deliverWebhookJob(job.data);
            }
            return { processed: jobs.length };
        }
    );
}

async function startLongTaskWorker(boss: PgBoss): Promise<void> {
    await boss.work<LongTaskJobPayload>(
        JOB_QUEUE_NAMES.longTaskProcess,
        {
            batchSize: 1,
            pollingIntervalSeconds: 1,
            localConcurrency: envNumber('PG_BOSS_TASK_CONCURRENCY', 2),
            heartbeatRefreshSeconds: 30,
            orderByCreatedOn: true,
        },
        async (jobs: Job<LongTaskJobPayload>[]) => {
            const { processTaskById } = await import('./task-service');
            for (const job of jobs) {
                await processTaskById(job.data.taskId);
            }
            return { processed: jobs.length };
        }
    );
}

export function startJobQueueWorkers(): Promise<void> {
    if (!workersPromise) {
        workersPromise = (async () => {
            const boss = await getJobQueue();
            await startBillingWorker(boss);
            await startWebhookWorker(boss);
            await startLongTaskWorker(boss);
            log.info('[JobQueue] Workers registered');
        })().catch((err) => {
            workersPromise = null;
            throw err;
        });
    }
    return workersPromise;
}
