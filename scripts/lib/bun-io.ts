import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ignoredDirectoryNames = new Set(['node_modules', '.git', 'dist', 'build']);

export async function pathExists(path: string): Promise<boolean> {
    return stat(path).then(() => true, () => false);
}

export async function readText(path: string): Promise<string> {
    return Bun.file(path).text();
}

export async function readJson<T>(path: string): Promise<T> {
    return Bun.file(path).json() as Promise<T>;
}

export async function writeText(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
    await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function ensureParentDir(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
}

export async function walkFiles(root: string, options: { readonly ignoredNames?: ReadonlySet<string> } = {}): Promise<string[]> {
    const ignoredNames = options.ignoredNames ?? ignoredDirectoryNames;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const entry of entries) {
        if (ignoredNames.has(entry.name)) continue;
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkFiles(path, options));
        } else {
            files.push(path);
        }
    }
    return files;
}

export type CommandResult = {
    readonly stdout: string;
    readonly stderr: string;
};

export async function runCommand(command: string, args: readonly string[], cwd?: string): Promise<CommandResult> {
    const proc = Bun.spawn([command, ...args], {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode === 0) return { stdout, stderr };
    throw new Error(`${command} ${args.join(' ')} failed with code ${exitCode}\n${stderr.trim()}`);
}
