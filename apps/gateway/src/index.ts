import { overrideConsole } from "./services/logger";
overrideConsole();

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";
import { jwt } from "@elysiajs/jwt";
import { authPlugin, adminGuard } from "./middleware/auth";
import { chatRouter } from "./routes/chat";
// TODO: Pending implementation
// import { claudeRouter } from "./routes/claude";
import { embeddingsRouter } from "./routes/embeddings";
import { imagesRouter } from "./routes/images";
import { adminRouter } from "./routes/admin";
import { redemptionsRouter } from "./routes/redemptions";
import { authRouter } from "./routes/auth";
import { audioRouter } from "./routes/audio";
import { rerankRouter } from "./routes/rerank";
// TODO: Pending implementation
// import { moderationsRouter } from "./routes/moderations";
// import { nativeGeminiRouter } from "./routes/gemini";
// import { responsesRouter } from "./routes/responses";
import { videoRouter } from "./routes/video";
import { sysRouter } from "./routes/sys";
import { mjRouter } from "./routes/mj";
import { paymentRouter } from "./routes/payment";
import { statsRouter } from "./routes/stats";
import { userStatsRouter } from "./routes/userStats";
import { memoryCache } from "./services/cache";
import { sql } from "@elygate/db";
import { initEnv } from "./services/env";
import { join } from "path";
import { type UserRecord, type TokenRecord } from "./types";
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
  // Serve static files if they exist (all-in-one mode)
  .onBeforeHandle(async ({ path, set }) => {
    if (path.startsWith('/api') || path.startsWith('/v1')) return;

    // 1. Determine priority search paths
    const buildPath = join(process.cwd(), 'apps/web/build');
    const clientPath = join(buildPath, 'client');
    const prerenderedPath = join(buildPath, 'prerendered');

    // Normalize path
    const normalizedPath = path === '/' ? '/index.html' : path;
    const isAsset = path.includes('.');

    // Search order: client assets -> prerendered pages -> build root -> SPA Fallback
    const searchPaths = [
      join(clientPath, path),
      join(prerenderedPath, normalizedPath.endsWith('.html') ? normalizedPath : `${normalizedPath}.html`),
      join(prerenderedPath, normalizedPath, 'index.html'),
      join(buildPath, normalizedPath)
    ];

    for (const fullPath of searchPaths) {
      const file = Bun.file(fullPath);
      if (await file.exists()) {
        // Caching Logic
        if (path.includes('/_app/immutable/')) {
          set.headers['Cache-Control'] = 'public, max-age=31536000, immutable';
        } else {
          set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        }

        // MIME Type Handling (Bun usually handles this, but explicit for safety)
        const ext = fullPath.split('.').pop();
        if (ext === 'js') set.headers['Content-Type'] = 'application/javascript; charset=utf-8';
        else if (ext === 'css') set.headers['Content-Type'] = 'text/css; charset=utf-8';
        else if (ext === 'html') set.headers['Content-Type'] = 'text/html; charset=utf-8';
        else if (ext === 'json') set.headers['Content-Type'] = 'application/json; charset=utf-8';

        return file;
      }
    }

    // 2. SPA Fallback: If not an asset request (no dot), return index.html
    if (!isAsset) {
      const indexFile = Bun.file(join(buildPath, 'index.html'));
      if (await indexFile.exists()) {
        set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        set.headers['Content-Type'] = 'text/html; charset=utf-8';
        return indexFile;
      }
    }
  })
  .use(sysRouter)
  .group("/api", (app) =>
    app.use(authRouter)
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
      .get('/models', ({ user, token, set }: any) => {
        if (!user || !token) {
          set.status = 401;
          return { success: false, message: "Unauthorized: Auth context missing" };
        }

        const u = user as UserRecord;
        const t = token as TokenRecord;

        let uniqueModels = Array.from(memoryCache.channelRoutes.keys());

        // 1. Token Key Restrictions
        if (t.models && t.models.length > 0) {
            uniqueModels = uniqueModels.filter(m => t.models.includes(m));
        }

        // 2. Group Policy Enforcer (Dual-Dimensional)
        const groupPolicy = memoryCache.userGroups.get(u.group);
        if (groupPolicy) {
            const matchPattern = (modelName: string, patternList: string[]) => {
                if (!patternList || patternList.length === 0) return false;
                return patternList.some((pattern: string) => {
                    if (pattern.endsWith('*')) return modelName.startsWith(pattern.slice(0, -1));
                    return modelName === pattern;
                });
            };

            uniqueModels = uniqueModels.filter(model => {
                // A. Active Package Exemption Bypass
                let isPackageFree = false;
                if (u.activePackages) {
                    for (const pkg of u.activePackages) {
                        if (pkg.models?.includes(model)) {
                            isPackageFree = true;
                            break;
                        }
                    }
                }
                if (isPackageFree) return true;

                // B. Allowed Models Filter (whitelist)
                if (groupPolicy.allowedModels && groupPolicy.allowedModels.length > 0) {
                    if (!matchPattern(model, groupPolicy.allowedModels)) {
                        return false;
                    }
                }

                // C. Denied Models Filter (blacklist)
                if (matchPattern(model, groupPolicy.deniedModels)) {
                    return false;
                }

                // D. Channel Type / Provider Filter
                let candidateChannels = memoryCache.selectChannels(model, u.group);
                if (groupPolicy.deniedChannelTypes && groupPolicy.deniedChannelTypes.length > 0) {
                    candidateChannels = candidateChannels.filter(ch => !groupPolicy.deniedChannelTypes.includes(ch.type));
                }
                if (groupPolicy.allowedChannelTypes && groupPolicy.allowedChannelTypes.length > 0) {
                    candidateChannels = candidateChannels.filter(ch => groupPolicy.allowedChannelTypes.includes(ch.type));
                }

                return candidateChannels.length > 0;
            });
        }

        return {
          object: 'list',
          data: uniqueModels.map(model => ({
            id: model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'elygate',
            permission: [],
            root: model,
            parent: null,
          }))
        };
      })
      .use(chatRouter)
      // .use(claudeRouter) // TODO
      .use(embeddingsRouter)
      .use(imagesRouter)
      .use(audioRouter)
      .use(rerankRouter)
      // .use(moderationsRouter) // TODO
      // .use(responsesRouter) // TODO
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
