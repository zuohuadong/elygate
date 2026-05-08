import { join } from "path";
import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";

const targets = [
    "bun-linux-x64",
    "bun-linux-arm64",
    "bun-darwin-x64",
    "bun-darwin-arm64",
    "bun-windows-x64",
];

const adminDist = join(process.cwd(), "apps/admin/dist");
const generatedAssetsFile = join(process.cwd(), "apps/gateway/src/generated/admin-assets.ts");
const emptyAssetsSource = `export type EmbeddedAsset = {
  contentType: string;
  base64: string;
};

export const embeddedAdminAssets: Record<string, EmbeddedAsset> = {};
`;

const contentTypes: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
};

function walk(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            files.push(...walk(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

function generateEmbeddedAdminAssets() {
    if (!existsSync(adminDist)) {
        throw new Error("apps/admin/dist not found. Run `bun run build` before building binaries.");
    }

    const assets: Record<string, { contentType: string; base64: string }> = {};
    for (const file of walk(adminDist)) {
        const relative = file.slice(adminDist.length).replaceAll("\\", "/");
        const route = relative.startsWith("/") ? relative : `/${relative}`;
        const ext = route.split(".").pop() || "";
        assets[route] = {
            contentType: contentTypes[ext] || "application/octet-stream",
            base64: readFileSync(file).toString("base64"),
        };
    }

    writeFileSync(generatedAssetsFile, `export type EmbeddedAsset = {
  contentType: string;
  base64: string;
};

export const embeddedAdminAssets: Record<string, EmbeddedAsset> = ${JSON.stringify(assets, null, 2)};
`);
    console.log(`Embedded ${Object.keys(assets).length} admin assets into gateway binary source.`);
}

function resetEmbeddedAdminAssets() {
    writeFileSync(generatedAssetsFile, emptyAssetsSource);
}

async function build(target: string) {
    console.log(`\n📦 Building for target: ${target}...`);

    const outfile = target.includes("windows") ? `elygate-${target}.exe` : `elygate-${target}`;

    const args = [
        "build",
        "apps/gateway/src/index.ts",
        "--compile",
        "--minify",
        "--outfile",
        outfile,
        "--target",
        target,
    ];

    console.log(`Running: bun ${args.join(" ")}`);

    const result = spawnSync("bun", args, {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
    });

    if (result.status !== 0) {
        console.error(`❌ Build failed for ${target}`);
        throw new Error(`Build failed for ${target}`);
    }

    console.log(`✅ Build successful: ${outfile}`);
}

async function main() {
    const arg = process.argv[2];

    try {
        generateEmbeddedAdminAssets();

        if (arg === "--all") {
            for (const target of targets) {
                await build(target);
            }
        } else if (arg) {
            if (targets.includes(arg) || arg.startsWith("bun-")) {
                await build(arg);
            } else {
                throw new Error(`Unknown target: ${arg}. Available targets: ${targets.join(", ")} or use --all`);
            }
        } else {
            // Default to current platform
            const platform = process.platform; // darwin, linux, win32
            const arch = process.arch; // x64, arm64

            let target = `bun-${platform === "win32" ? "windows" : platform}-${arch}`;
            await build(target);
        }
    } finally {
        resetEmbeddedAdminAssets();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
