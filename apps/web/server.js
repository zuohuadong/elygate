import { serve } from "bun";
import { join } from "path";
import { existsSync } from "fs";

const port = parseInt(process.env.PORT || "3001", 10);

// Auto-detect build directory location
let buildDir = join(process.cwd(), "build");
if (!existsSync(buildDir)) {
    buildDir = join(process.cwd(), "apps/web/build");
}

console.log(`Serving static files from ${buildDir} on port ${port} (hostname: 0.0.0.0)`);

serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = join(buildDir, path);

        if (existsSync(filePath) && (await Bun.file(filePath).exists())) {
            return new Response(Bun.file(filePath));
        }

        const fallbackPath = join(buildDir, "index.html");
        if (existsSync(fallbackPath)) {
            return new Response(Bun.file(fallbackPath));
        }

        return new Response("Not Found", { status: 404 });
    },
});
