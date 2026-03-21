import { overrideConsole } from "./services/logger";
overrideConsole();

import { initEnv } from "./services/env";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { jwt } from "@elysiajs/jwt";
import { join } from "path";
import "./services/health";

// Startup readiness check
async function init() {
  // 0. Initialize environment and secrets (MUST be first)
  await initEnv();

  // 1. Dyamically import environment-dependent modules
  const { sql } = await import("@elygate/db");
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
  const { sysRouter } = await import("./routes/sys");
  const { mjRouter } = await import("./routes/mj");
  const { paymentRouter } = await import("./routes/payment");
  const { statsRouter } = await import("./routes/stats");
  const { userStatsRouter } = await import("./routes/userStats");
  const { modelsRouter } = await import("./routes/models");

  const app = new Elysia()
    .use(cors({
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Request-ID', 'Cookie'],
      exposeHeaders: ['Set-Cookie'],
      credentials: true
    }))
    .use(jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET!,
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
    .onParse(async ({ request, contentType }) => {
      if (contentType === 'application/json') {
        const txt = await request.text();
        try { return JSON.parse(txt); } catch (e) { return {}; }
      }
    })
    .onError(({ error }) => {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    })
    .onBeforeHandle(staticFileHandler())
    .use(sysRouter)
    .group("/api", (app) =>
      app.get('/status', async () => {
        const rows = await sql`
          SELECT name, type, status, status_message AS "statusMessage", updated_at AS "updatedAt"
          FROM channels
          ORDER BY priority DESC, weight DESC
        `;
        return rows;
      })
      .get('/info', async () => {
        const keys = ['ServerName', 'SEO_Title', 'SEO_Description', 'SEO_Keywords', 'Logo_URL', 'Footer_HTML', 'Custom_CSS', 'Custom_JS'];
        const rows = await sql`SELECT key, value FROM options WHERE key IN ${sql(keys)}`;
        const info: Record<string, string> = {};
        for (const r of rows) info[r.key] = r.value;
        return { success: true, data: info };
      })
      .use(authRouter)
      .use(paymentRouter)
      .group("/admin", (app) => app.use(adminRouter))
      .group("/stats", (app) => app.use(statsRouter))
      .group("/redemptions", (app) => app.use(authPlugin).use(redemptionsRouter))
      .use(userStatsRouter)
      .use(mjRouter)
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
    )
    .get("*", async ({ request, set }) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/v1')) {
        const fallback = join(process.cwd(), 'apps/web/build/index.html');
        const file = Bun.file(fallback);
        if (await file.exists()) {
          return file;
        }
      }
      set.status = 404;
      return { error: 'Not Found' };
    });

  console.log("⏳ Waiting for database readiness...");
  let retries = 0;
  const maxRetries = 15;
  while (retries < maxRetries) {
    try {
      await sql`SELECT 1`;
      console.log("✅ Database is ready.");
      break;
    } catch (err: any) {
      retries++;
      console.log(`[DB] Retry ${retries}/${maxRetries}: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const findSqlPath = async (relativePath: string) => {
    const paths = [
      join(process.cwd(), relativePath),
      join(process.cwd(), '../../', relativePath),
      join(__dirname, '../../../', relativePath)
    ];
    for (const p of paths) {
      if (await Bun.file(p).exists()) return p;
    }
    return null;
  };

  const patches = [
    'packages/db/src/patch_v1_schema_fix.sql',
    'packages/db/src/patch_v2_channel_status.sql'
  ];
  for (const p of patches) {
    const patchPath = await findSqlPath(p);
    if (patchPath) {
      try {
        const patchSql = await Bun.file(patchPath).text();
        await sql.unsafe(patchSql);
        console.log(`✅ Schema patch ${p.split('/').pop()} applied.`);
      } catch (e: any) {
        console.error(`❌ Failed to apply patch ${p}:`, e.message);
      }
    }
  }

  const perfIndexesPath = await findSqlPath('packages/db/src/performance_indexes.sql');
  if (perfIndexesPath) {
    try {
      const perfSql = await Bun.file(perfIndexesPath).text();
      await sql.unsafe(perfSql);
      console.log("📊 Performance indexes verified/applied.");
    } catch (e: any) {
      console.log("ℹ️ Performance indexes check:", e.message);
    }
  }

  memoryCache.refresh().catch(console.error);

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword) {
    try {
      const passwordHash = await Bun.password.hash(adminPassword);
      const [updated] = await sql`
        UPDATE users 
        SET password_hash = ${passwordHash}, updated_at = NOW() 
        WHERE username = 'admin' AND role = 10
        RETURNING id
      `;
      if (updated) {
        console.log("💎 Admin password synchronized from environment.");
      } else {
        await sql`
          INSERT INTO users (username, password_hash, role, quota)
          VALUES ('admin', ${passwordHash}, 10, 100000000)
          ON CONFLICT (username) DO UPDATE 
          SET password_hash = ${passwordHash}, updated_at = NOW()
        `;
        console.log("💎 Admin user initialized/synced from environment.");
      }
    } catch (e: any) {
      console.error("❌ Failed to sync admin password:", e.message);
    }
  }
  
  memoryCache.startCleanupTask();

  const refreshMaterializedViews = async () => {
    try {
      await sql`REFRESH MATERIALIZED VIEW mv_system_overview`;
      await sql`REFRESH MATERIALIZED VIEW mv_model_usage_stats`;
      console.log('[MV] Materialized views refreshed');
    } catch (e: any) {
      console.error('[MV] Failed to refresh materialized views:', e.message);
    }
  };
  
  refreshMaterializedViews();
  setInterval(refreshMaterializedViews, 5 * 60 * 1000);

  app.listen({
    port: 3000,
    hostname: "0.0.0.0"
  });
  console.log(`🦊 AI API Gateway is running at ${app.server?.hostname}:${app.server?.port}`);
}

init();
