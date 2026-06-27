import { join, relative } from "path";

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

async function generateEmbeddedAdminAssets() {
    if (!await Bun.file(join(adminDist, "index.html")).exists()) {
        throw new Error("apps/admin/dist not found. Run `bun run build` before building binaries.");
    }

    const assets: Record<string, { contentType: string; base64: string }> = {};
    const glob = new Bun.Glob("**/*");
    for await (const file of glob.scan({ cwd: adminDist, absolute: true, onlyFiles: true })) {
        const relativePath = relative(adminDist, file).replaceAll("\\", "/");
        const route = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
        const ext = route.split(".").pop() || "";
        const bytes = await Bun.file(file).bytes();
        assets[route] = {
            contentType: contentTypes[ext] || "application/octet-stream",
            base64: bytes.toBase64(),
        };
    }

    await Bun.write(generatedAssetsFile, `export type EmbeddedAsset = {
  contentType: string;
  base64: string;
};

export const embeddedAdminAssets: Record<string, EmbeddedAsset> = ${JSON.stringify(assets, null, 2)};
`);
    console.log(`Embedded ${Object.keys(assets).length} admin assets into gateway binary source.`);
}

async function resetEmbeddedAdminAssets() {
    await Bun.write(generatedAssetsFile, emptyAssetsSource);
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

    const result = Bun.spawn(["bun", ...args], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
    });
    const exitCode = await result.exited;

    if (exitCode !== 0) {
        console.error(`❌ Build failed for ${target}`);
        throw new Error(`Build failed for ${target}`);
    }

    console.log(`✅ Build successful: ${outfile}`);
}

async function main() {
    const arg = process.argv[2];

    try {
        await generateEmbeddedAdminAssets();

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
        await resetEmbeddedAdminAssets();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
