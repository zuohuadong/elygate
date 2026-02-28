import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { authPlugin } from "./middleware/auth";
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
import { memoryCache } from "./services/cache";

const app = new Elysia()
  .use(cors())
  .use(swagger({
    documentation: {
      info: {
        title: 'AI API Gateway',
        version: '1.0.0'
      }
    }
  }))
  .get("/", () => "Welcome to AI API Gateway")
  .use(sysRouter)
  .group("/api", (app) =>
    app.use(adminRouter)
      .use(redemptionsRouter)
      .use(authRouter)
  )
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
  .listen(3000);

console.log(`🦊 AI API Gateway is running at ${app.server?.hostname}:${app.server?.port}`);

// Refresh channel cache on initialization
memoryCache.refresh().catch(console.error);

