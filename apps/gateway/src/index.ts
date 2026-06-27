import { config } from './config';
import { log } from './services/logger';
import { getErrorMessage } from './utils/error';
import { overrideConsole } from "./services/logger";
overrideConsole();

import { initEnv } from "./services/env";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { jwt } from "@elysiajs/jwt";
import { workspacePath } from "./utils/paths";
import "./services/health";

async function installEnterpriseRuntimeGuardIfEnabled(enterpriseRuntimeConfig: { readonly enabled: boolean }) {
  if (!enterpriseRuntimeConfig.enabled) return;
  const { installEnterpriseRuntimeGuard } = await import('./enterprise/runtimeGuard');
  installEnterpriseRuntimeGuard();
}

async function init() {
  await initEnv();

  const { db } = await import("@elygate/db");
  const { channels, users, options } = await import("@elygate/db/schema");
  const drizzleOrm = await import("drizzle-orm");
  const drizzleSql = drizzleOrm.sql;
  const { memoryCache } = await import("./services/cache");
  const { authPlugin } = await import("./middleware/auth");
  const { staticFileHandler } = await import("./middleware/static");
  const { chatRouter } = await import("./routes/chat");
  const { embeddingsRouter } = await import("./routes/embeddings");
  const { imagesRouter } = await import("./routes/images");
  const { adminRouter } = await import("./routes/admin/index");
  const { redemptionsRouter } = await import("./routes/redemptions");
  const { authRouter } = await import("./routes/auth");
  const { audioRouter } = await import("./routes/audio");
  const { rerankRouter } = await import("./routes/rerank");
  const { videoRouter } = await import("./routes/video");
  const { tasksRouter } = await import("./routes/tasks");
  const { sysRouter } = await import("./routes/sys");
  const { mjRouter } = await import("./routes/mj");
  const { paymentRouter } = await import("./routes/payment");
  const { statsRouter } = await import("./routes/stats");
  const { userStatsRouter } = await import("./routes/userStats");
  const { modelsRouter } = await import("./routes/models");
  const { v1StatsRouter } = await import("./routes/v1-stats");
  const { geminiRouter } = await import("./routes/gemini");
  const { aliRouter } = await import("./routes/ali");
  const { baiduRouter } = await import("./routes/baidu");
  const { anthropicRouter } = await import("./routes/anthropic");
  const { moderationsRouter } = await import("./routes/moderations");
  const { capabilitiesRouter } = await import("./routes/capabilities");
  const { workflowsRouter } = await import("./routes/workflows");
  const { responsesRouter } = await import('./routes/responses');
  const { completionsRouter } = await import('./routes/completions');
  const { filesRouter } = await import('./routes/files');
  const { batchesRouter } = await import('./routes/batches');
  const { editsRouter } = await import('./routes/edits');
  const { realtimeRouter } = await import('./routes/realtime');
  const { openaiEnterpriseRouter } = await import('./routes/openai-enterprise');
  const { fineTuneRouter } = await import('./routes/fine-tune');
  const { newApiRelayCompatRouter } = await import('./routes/newApiRelayCompat');
  const { dashboardBillingRouter } = await import('./routes/dashboard-billing');
  const { newApiCompatAdminRouter, newApiCompatSelfRouter } = await import('./routes/admin/newApiCompat');
  const { newApiUserAdminRouter, newApiUserSelfRouter, newApiUserPublicRouter } = await import('./routes/admin/newApiUserCompat');
  const { enterpriseRouter } = await import('./enterprise/router');
  const { enterpriseRuntimeConfig } = await import('./enterprise/config');

  await installEnterpriseRuntimeGuardIfEnabled(enterpriseRuntimeConfig);

  const app = new Elysia()
    .use(cors({
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Request-ID', 'Cookie', 'OpenAI-Organization', 'x-api-key', 'anthropic-version', 'x-goog-api-key'],
      exposeHeaders: ['Set-Cookie'],
      credentials: true
    }))
    .use(jwt({
      name: 'jwt',
      secret: config.jwtSecret!,
      exp: '7d'
    }))
    .state('auth_session', '')
    .use(swagger({
      documentation: {
        info: {
          title: 'AI API Gateway',
          version: '1.0.0'
        }
      }
    }))
    .onError(({ error }) => {
      return { success: false, message: error instanceof Error ? getErrorMessage(error) : String(error) };
    })
    .onBeforeHandle(staticFileHandler() as any)
    .use(dashboardBillingRouter)
    .use(sysRouter)
    .use(newApiRelayCompatRouter)
    .use(mjRouter)
    .group("/api", (app) =>
      app.get('/status', async () => {
        const rows = await db.select({
          name: channels.name,
          type: channels.type,
          status: channels.status,
          statusMessage: channels.statusMessage,
          updatedAt: channels.updatedAt,
        }).from(channels)
          .orderBy(drizzleOrm.desc(channels.priority), drizzleOrm.desc(channels.weight));
        return rows;
      })
      .get('/info', async () => {
        const keys = ['ServerName', 'SEO_Title', 'SEO_Description', 'SEO_Keywords', 'Logo_URL', 'Footer_HTML', 'Custom_CSS', 'Custom_JS'];
        const rows = await db.select().from(options).where(drizzleOrm.inArray(options.key, keys));
        const info: Record<string, string> = {};
        for (const r of rows) info[r.key] = r.value;
        return { success: true, data: info };
      })
      .group("/auth", (app) => app.use(authRouter))
      .group("/enterprise", (app) => app.use(enterpriseRouter))
      .use(paymentRouter)
      .group("/admin", (app) => app.use(adminRouter))
      .use(newApiUserPublicRouter)
      .use(newApiCompatSelfRouter)
      .use(newApiUserSelfRouter)
      .use(newApiCompatAdminRouter)
      .use(newApiUserAdminRouter)
      .group("/stats", (app) => app.use(statsRouter))
      .group("/redemptions", (app) => app.use(authPlugin).use(redemptionsRouter))
      .use(userStatsRouter)
      .use(mjRouter)
    )
    .group("/pg", (app) =>
      app.use(authPlugin)
        .use(chatRouter)
    )
    .group("/v1", (app) =>
      app.use(authPlugin)
        .use(modelsRouter)
        .use(chatRouter)
        .use(embeddingsRouter)
        .use(imagesRouter)
        .use(audioRouter)
        .use(rerankRouter)
        .use(videoRouter)
        .use(tasksRouter)
        .use(v1StatsRouter)
        .use(anthropicRouter)
        .use(moderationsRouter)
        .use(capabilitiesRouter)
        .use(workflowsRouter)
        .use(responsesRouter)
        .use(completionsRouter)
        .use(filesRouter)
        .use(batchesRouter)
        .use(editsRouter)
        .use(realtimeRouter)
        .use(openaiEnterpriseRouter)
        .use(fineTuneRouter)
    )
    .group("/v1beta/openai", (app) =>
      app.use(authPlugin)
        .use(modelsRouter)
    )
    .use(geminiRouter)
    .use(aliRouter)
    .use(baiduRouter)
    .get("*", async ({ request, set }) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/v1')) {
        const fallback = workspacePath('apps/portal/build/index.html');
        const file = Bun.file(fallback);
        if (await file.exists()) {
          return file;
        }
      }
      set.status = 404;
      return { error: 'Not Found' };
    });

  await waitForDatabaseReady(() => db.execute(drizzleSql`SELECT 1`));

  memoryCache.refresh().catch((e: unknown) => log.error("[Async]", e));

  await syncAdminPassword(async (passwordHash) => {
    const [updated] = await db.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(drizzleOrm.and(drizzleOrm.eq(users.username, 'admin'), drizzleOrm.eq(users.role, 10)))
      .returning({ id: users.id });

    if (updated) return 'updated';

    await db.insert(users).values({
      username: 'admin',
      passwordHash,
      role: 10,
      quota: 100000000,
    }).onConflictDoUpdate({
      target: users.username,
      set: { passwordHash, updatedAt: new Date() },
    });
    return 'created';
  });

  await startBackgroundServices({
    startCacheTasks: () => {
      memoryCache.startCleanupTask();
      memoryCache.startDiscoverySyncTask();
    },
    refreshMaterializedViews: async () => {
      await db.execute(drizzleSql`REFRESH MATERIALIZED VIEW mv_system_overview`);
      await db.execute(drizzleSql`REFRESH MATERIALIZED VIEW mv_model_usage_stats`);
    },
  });

  app.listen({
    port: config.port,
    hostname: "0.0.0.0"
  });
  log.info(`🦊 AI API Gateway is running at ${app.server?.hostname}:${app.server?.port}`);
}

async function waitForDatabaseReady(ping: () => Promise<unknown>) {
  log.info("⏳ Waiting for database readiness...");
  let retries = 0;
  const maxRetries = 15;
  while (retries < maxRetries) {
    try {
      await ping();
      log.info("✅ Database is ready.");
      return;
    } catch (err: unknown) {
      retries++;
      log.info(`[DB] Retry ${retries}/${maxRetries}: ${getErrorMessage(err)}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function syncAdminPassword(sync: (passwordHash: string) => Promise<'updated' | 'created'>) {
  const adminPassword = config.adminPassword;
  if (!adminPassword) return;

  try {
    const passwordHash = await Bun.password.hash(adminPassword);
    const result = await sync(passwordHash);
    log.info(result === 'updated'
      ? "💎 Admin password synchronized from environment."
      : "💎 Admin user initialized/synced from environment.");
  } catch (e: unknown) {
    log.error("❌ Failed to sync admin password:", getErrorMessage(e));
  }
}

async function startBackgroundServices(options: {
  readonly startCacheTasks: () => void;
  readonly refreshMaterializedViews: () => Promise<void>;
}) {
  options.startCacheTasks();

  try {
    const { startJobQueueWorkers } = await import('./services/jobQueue');
    await startJobQueueWorkers();
  } catch (e: unknown) {
    log.error('[JobQueue] Failed to start pg-boss workers:', getErrorMessage(e));
  }

  const { startTaskWorker } = await import('./services/task-service');
  startTaskWorker();

  const { startBatchExecutor } = await import('./services/batchExecutor');
  startBatchExecutor();

  const refreshMaterializedViews = async () => {
    try {
      await options.refreshMaterializedViews();
      log.info('[MV] Materialized views refreshed');
    } catch (e: unknown) {
      log.error('[MV] Failed to refresh materialized views:', getErrorMessage(e));
    }
  };

  refreshMaterializedViews();
  setInterval(refreshMaterializedViews, 5 * 60 * 1000);
}

init();
