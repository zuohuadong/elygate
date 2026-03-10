import { join } from "path";
import { spawnSync } from "child_process";

const targets = [
    "bun-linux-x64",
    "bun-linux-arm64",
    "bun-darwin-x64",
    "bun-darwin-arm64",
    "bun-windows-x64",
];

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
        process.exit(1);
    }

    console.log(`✅ Build successful: ${outfile}`);
}

async function main() {
    const arg = process.argv[2];

    if (arg === "--all") {
        for (const target of targets) {
            await build(target);
        }
    } else if (arg) {
        if (targets.includes(arg) || arg.startsWith("bun-")) {
            await build(arg);
        } else {
            console.error(`Unknown target: ${arg}`);
            console.log(`Available targets: ${targets.join(", ")} or use --all`);
            process.exit(1);
        }
    } else {
        // Default to current platform
        const platform = process.platform; // darwin, linux, win32
        const arch = process.arch; // x64, arm64

        let target = `bun-${platform === "win32" ? "windows" : platform}-${arch}`;
        await build(target);
    }
}

main().catch(console.error);
