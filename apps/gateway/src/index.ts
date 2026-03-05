import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";
import { authPlugin, adminGuard } from "./middleware/auth";
import { chatRouter } from "./routes/chat";
import { modelsRouter } from "./routes/models";
import { embeddingsRouter } from "./routes/embeddings";
import { imagesRouter } from "./routes/images";
import { adminRouter } from "./routes/admin";
import { redemptionsRouter } from "./routes/redemptions";
import { authRouter } from "./routes/auth";
import { audioRouter } from "./routes/audio";
import { rerankRouter } from "./routes/rerank";
import { videoRouter } from "./routes/video";
import { sysRouter } from "./routes/sys";
import { mjRouter } from "./routes/mj";
import { paymentRouter } from "./routes/payment";
import { statsRouter } from "./routes/stats";
import { memoryCache } from "./services/cache";
import { auth as betterAuthInstance } from "./services/betterAuth";
import { sql } from "@elygate/db";
import { join } from "path";
import { existsSync, statSync } from "fs";
import "./services/health";

const app = new Elysia()
  .use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
    credentials: true
  }))
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
  // Serve static files if they exist (all-in-one mode)
  .onBeforeHandle(({ path }) => {
    if (path.startsWith('/api') || path.startsWith('/v1')) return;
    const staticPath = join(process.cwd(), 'apps/web/build', path === '/' ? 'index.html' : path);
    if (existsSync(staticPath) && statSync(staticPath).isFile()) {
      return Bun.file(staticPath);
    }
  })
  // .mount("/api/auth/better", betterAuthInstance.handler)
  .use(sysRouter)
  .group("/api", (app) =>
    app.group("/auth", (app) => app.use(authRouter))
      .group("/payment", (app) => app.use(paymentRouter))
      .group("/admin", (app) => app.use(adminRouter))
      .group("/stats", (app) => app.use(statsRouter))
      .group("/redemptions", (app) => app.use(authPlugin).use(redemptionsRouter))
  )
  .use(mjRouter)
  .group("/v1/chat", (app) =>
    app.use(chatRouter)
  )
  .group("/v1", (app) =>
    app.use(embeddingsRouter)
      .use(imagesRouter)
      .use(audioRouter)
      .use(rerankRouter)
      .use(videoRouter)
  )
  .use(modelsRouter)
  // SPA Fallback for static Web UI
  .get("*", async ({ request, set }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/v1')) {
      const fallback = join(process.cwd(), 'apps/web/build/index.html');
      if (existsSync(fallback)) {
        return Bun.file(fallback);
      }
    }
    set.status = 404;
    return { error: 'Not Found' };
  })

// Startup readiness check
async function init() {
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

  // Run schema fix patch if exists (idempotent)
  const patchPath = join(process.cwd(), '../../packages/db/src/patch_v1_schema_fix.sql');
  if (existsSync(patchPath)) {
    try {
      const patchSql = await Bun.file(patchPath).text();
      await sql.unsafe(patchSql);
      console.log("✅ Schema fix patch reapplied.");
    } catch (e: any) {
      console.error("❌ Failed to reapply schema patch:", e.message);
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
