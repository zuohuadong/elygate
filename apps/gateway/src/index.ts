import { overrideConsole } from "./services/logger";
overrideConsole();

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { jwt } from "@elysiajs/jwt";
import { authPlugin } from "./middleware/auth";
import { staticFileHandler } from "./middleware/static";
import { chatRouter } from "./routes/chat";
import { embeddingsRouter } from "./routes/embeddings";
import { imagesRouter } from "./routes/images";
import { adminRouter } from "./routes/admin/index";
import { redemptionsRouter } from "./routes/redemptions";
import { authRouter } from "./routes/auth";
import { audioRouter } from "./routes/audio";
import { rerankRouter } from "./routes/rerank";
import { videoRouter } from "./routes/video";
import { sysRouter } from "./routes/sys";
import { mjRouter } from "./routes/mj";
import { paymentRouter } from "./routes/payment";
import { statsRouter } from "./routes/stats";
import { userStatsRouter } from "./routes/userStats";
import { modelsRouter } from "./routes/models";
import { memoryCache } from "./services/cache";
import { sql } from "@elygate/db";
import { initEnv } from "./services/env";
import { join } from "path";
import "./services/health";

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
  .onError(({ code, error, set }) => {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  })
  .onBeforeHandle(staticFileHandler())
  .use(sysRouter)
  .group("/api", (app) =>
    app.get('/status', async () => {
      // Returns a simplified list of channels and their status for public consumption
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
  // OpenAI & Anthropic compatible API endpoints (standard /v1 prefix)
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
  // Native Gemini support (2026 standard)
  // .group("/v1beta", (app) =>
  //   app.use(authPlugin).use(nativeGeminiRouter)
  // )
  // SPA Fallback for static Web UI
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
  })

// Startup readiness check
async function init() {
  // 0. Initialize environment and secrets
  await initEnv();

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

  // Resolve SQL paths robustly for both local dev and Docker production
  const findSqlPath = async (relativePath: string) => {
    const paths = [
      join(process.cwd(), relativePath),                        // From root (Docker)
      join(process.cwd(), '../../', relativePath),              // From apps/gateway (Local dev)
      join(__dirname, '../../../', relativePath)                // Absolute fallback
    ];
    for (const p of paths) {
      if (await Bun.file(p).exists()) return p;
    }
    return null;
  };

  // Run schema fix patches (v1, v2) if exist (idempotent)
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

  // Apply Performance Indexes (idempotent)
  const perfIndexesPath = await findSqlPath('packages/db/src/performance_indexes.sql');
  if (perfIndexesPath) {
    try {
      const perfSql = await Bun.file(perfIndexesPath).text();
      // Use unsafe for multi-statement scripts including CONCURRENTLY index creation
      await sql.unsafe(perfSql);
      console.log("📊 Performance indexes verified/applied.");
    } catch (e: any) {
      // Index creation might fail if already exists or concurrent issues, log but don't crash
      console.log("ℹ️ Performance indexes check:", e.message);
    }
  }

  // Refresh channel cache
  memoryCache.refresh().catch(console.error);

  app.listen({
    port: 3000,
    hostname: "0.0.0.0"
  });
  console.log(`🦊 AI API Gateway is running at ${app.server?.hostname}:${app.server?.port}`);
}

init();
