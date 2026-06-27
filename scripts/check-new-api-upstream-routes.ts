import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureParentDir, pathExists, readJson, readText, runCommand, writeJson } from './lib/bun-io';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

type RouteStatus = 'implemented' | 'partial' | 'missing' | 'blocked';

type RouteGroup = {
    readonly id: string;
    readonly status: RouteStatus;
    readonly source: string;
    readonly routes: readonly string[];
    readonly elygateEvidence: readonly string[];
    readonly blockers: readonly string[];
};

type RouteParityMatrix = {
    readonly version: number;
    readonly objective: string;
    readonly sourceSnapshot: {
        readonly project: string;
        readonly commit: string;
        readonly checkedAt: string;
        readonly evidence: readonly string[];
    };
    readonly completionPolicy: {
        readonly routeCoverage: string;
        readonly redisPolicy: string;
        readonly strictCommand: string;
    };
    readonly routeGroups: readonly RouteGroup[];
};

type Options = {
    readonly repoUrl: string;
    readonly ref: string;
    readonly cacheDir: string;
    readonly allowNewerCommit: boolean;
    readonly offline: boolean;
    readonly reportPath: string | null;
};

type UpstreamRoute = {
    readonly method: HttpMethod;
    readonly path: string;
    readonly source: string;
    readonly line: number;
};

type MatrixRoutePattern = {
    readonly methods: readonly HttpMethod[];
    readonly path: string;
    readonly raw: string;
    readonly groupId: string;
};

type FunctionRange = {
    readonly start: number;
    readonly end: number;
};

type RouteCoverage = UpstreamRoute & {
    readonly covered: boolean;
    readonly coveredBy: readonly string[];
};

type PublicApiSyncReport = {
    readonly version: 1;
    readonly generatedAt: string;
    readonly upstream: {
        readonly project: string;
        readonly repoUrl: string;
        readonly ref: string;
        readonly commit: string;
        readonly pinnedCommit: string;
        readonly pinnedCheckedAt: string;
        readonly sourceFiles: readonly string[];
    };
    readonly coverage: {
        readonly totalRoutes: number;
        readonly coveredRoutes: number;
        readonly missingRoutes: number;
        readonly matrixPatterns: number;
        readonly matrixGroups: number;
        readonly commitDrift: boolean;
    };
    readonly routes: readonly RouteCoverage[];
    readonly missingRoutes: readonly UpstreamRoute[];
};

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = join(workspaceRoot, 'docs/new-api-route-parity.matrix.json');
const defaultCacheDir = process.env.ELYGATE_NEW_API_REFERENCE_DIR || '/tmp/elygate-new-api-reference';
const defaultRepoUrl = 'https://github.com/QuantumNous/new-api.git';

function parseArgs(argv: readonly string[]): Options {
    const mutable: {
        repoUrl: string;
        ref: string;
        cacheDir: string;
        allowNewerCommit: boolean;
        offline: boolean;
        reportPath: string | null;
    } = {
        repoUrl: defaultRepoUrl,
        ref: 'HEAD',
        cacheDir: defaultCacheDir,
        allowNewerCommit: false,
        offline: false,
        reportPath: null,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === '--repo-url' && next) {
            mutable.repoUrl = next;
            i += 1;
        } else if (arg === '--ref' && next) {
            mutable.ref = next;
            i += 1;
        } else if (arg === '--cache-dir' && next) {
            mutable.cacheDir = next;
            i += 1;
        } else if (arg === '--report-path' && next) {
            mutable.reportPath = next;
            i += 1;
        } else if (arg === '--allow-newer-commit') {
            mutable.allowNewerCommit = true;
        } else if (arg === '--offline') {
            mutable.offline = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return mutable;
}

function printHelp(): void {
    console.log(`Usage: bun run scripts/check-new-api-upstream-routes.ts [options]

Checks QuantumNous/new-api upstream route drift against docs/new-api-route-parity.matrix.json.

Options:
  --repo-url <url>          Upstream git URL. Default: ${defaultRepoUrl}
  --ref <ref>               Remote ref to inspect. Default: HEAD
  --cache-dir <path>        Local upstream checkout cache. Default: ${defaultCacheDir}
  --report-path <path>      Write a JSON public API sync report.
  --allow-newer-commit      Do not fail only because upstream HEAD differs from the pinned matrix commit.
  --offline                 Use the existing cache-dir checkout without fetching.
`);
}

async function resolveUpstreamCommit(options: Options): Promise<string> {
    if (options.offline) {
        const result = await runCommand('git', ['rev-parse', 'HEAD'], options.cacheDir);
        return result.stdout.trim();
    }

    const result = await runCommand('git', ['ls-remote', options.repoUrl, options.ref]);
    const firstLine = result.stdout.trim().split(/\r?\n/)[0] || '';
    const commit = firstLine.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(commit)) {
        throw new Error(`Unable to resolve ${options.repoUrl} ${options.ref}`);
    }
    return commit;
}

async function ensureUpstreamCheckout(options: Options, commit: string): Promise<void> {
    if (options.offline) return;

    if (!(await pathExists(join(options.cacheDir, '.git')))) {
        await ensureParentDir(options.cacheDir);
        await runCommand('git', ['clone', '--depth=1', options.repoUrl, options.cacheDir]);
    } else {
        await runCommand('git', ['fetch', '--depth=1', 'origin', options.ref], options.cacheDir);
    }

    await runCommand('git', ['checkout', '--detach', commit], options.cacheDir);
}

function normalizePath(path: string): string {
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    const compact = withLeadingSlash.replace(/\/+/g, '/');
    return compact.length > 1 ? compact.replace(/\/$/, '') : compact;
}

function joinRoutePath(prefix: string, child: string): string {
    if (!child || child === '/') return normalizePath(prefix || '/');
    return normalizePath(`${normalizePath(prefix || '/')}/${child}`);
}

function stripLineComment(line: string): string {
    const index = line.indexOf('//');
    return index >= 0 ? line.slice(0, index) : line;
}

function methodFromString(value: string): HttpMethod | null {
    return HTTP_METHODS.find((method) => method === value) ?? null;
}

function findFunctionRange(lines: readonly string[], functionName: string): FunctionRange | null {
    const start = lines.findIndex((line) => new RegExp(`\\bfunc\\s+${functionName}\\b`).test(line));
    if (start < 0) return null;

    let depth = 0;
    let opened = false;
    for (let i = start; i < lines.length; i += 1) {
        const line = stripLineComment(lines[i]);
        for (const char of line) {
            if (char === '{') {
                opened = true;
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (opened && depth === 0) return { start, end: i };
            }
        }
    }

    return null;
}

function isWithinRange(lineIndex: number, range: FunctionRange | null): boolean {
    return range !== null && lineIndex >= range.start && lineIndex <= range.end;
}

function addRoute(uniqueRoutes: Map<string, UpstreamRoute>, route: UpstreamRoute): void {
    const key = `${route.method} ${route.path}`;
    if (!uniqueRoutes.has(key)) uniqueRoutes.set(key, route);
}

function parseGroupPrefixes(lines: readonly string[], helperRange: FunctionRange | null): Map<string, string> {
    const prefixes = new Map<string, string>([['router', '']]);
    const groupRegex = /\b([A-Za-z_]\w*)\s*:=\s*([A-Za-z_]\w*)\.Group\("([^"]*)"\)/;

    for (let i = 0; i < lines.length; i += 1) {
        if (isWithinRange(i, helperRange)) continue;
        const match = stripLineComment(lines[i]).match(groupRegex);
        if (!match) continue;

        const [, variableName, parentName, childPath] = match;
        const parentPrefix = prefixes.get(parentName);
        if (parentPrefix === undefined) continue;
        prefixes.set(variableName, joinRoutePath(parentPrefix, childPath));
    }

    return prefixes;
}

function extractDirectRoutes(
    lines: readonly string[],
    source: string,
    helperRange: FunctionRange | null,
    prefixes: ReadonlyMap<string, string>,
    uniqueRoutes: Map<string, UpstreamRoute>,
): void {
    const routeRegex = /\b([A-Za-z_]\w*)\.(GET|POST|PUT|PATCH|DELETE)\("([^"]*)"/;

    for (let i = 0; i < lines.length; i += 1) {
        if (isWithinRange(i, helperRange)) continue;
        const match = stripLineComment(lines[i]).match(routeRegex);
        if (!match) continue;

        const [, variableName, methodName, childPath] = match;
        const method = methodFromString(methodName);
        const prefix = prefixes.get(variableName);
        if (!method || prefix === undefined) continue;

        addRoute(uniqueRoutes, {
            method,
            path: joinRoutePath(prefix, childPath),
            source,
            line: i + 1,
        });
    }
}

function extractRegisterMjRoutes(
    lines: readonly string[],
    source: string,
    helperRange: FunctionRange | null,
    prefixes: ReadonlyMap<string, string>,
    uniqueRoutes: Map<string, UpstreamRoute>,
): void {
    if (!helperRange) return;

    const helperHeader = lines[helperRange.start];
    const parameterName = helperHeader.match(/\bregisterMjRouterGroup\((\w+)/)?.[1];
    if (!parameterName) return;

    const childRoutes: Array<{ readonly method: HttpMethod; readonly path: string; readonly line: number }> = [];
    const routeRegex = new RegExp(`\\b${parameterName}\\.(GET|POST|PUT|PATCH|DELETE)\\("([^"]*)"`);
    for (let i = helperRange.start; i <= helperRange.end; i += 1) {
        const match = stripLineComment(lines[i]).match(routeRegex);
        if (!match) continue;
        const method = methodFromString(match[1]);
        if (!method) continue;
        childRoutes.push({ method, path: match[2], line: i + 1 });
    }

    const callRegex = /\bregisterMjRouterGroup\((\w+)\)/;
    for (let i = 0; i < lines.length; i += 1) {
        if (isWithinRange(i, helperRange)) continue;
        const call = stripLineComment(lines[i]).match(callRegex);
        if (!call) continue;

        const prefix = prefixes.get(call[1]);
        if (prefix === undefined) continue;
        for (const childRoute of childRoutes) {
            addRoute(uniqueRoutes, {
                method: childRoute.method,
                path: joinRoutePath(prefix, childRoute.path),
                source,
                line: childRoute.line,
            });
        }
    }
}

function extractRoutesFromSource(source: string, content: string): UpstreamRoute[] {
    const lines = content.split(/\r?\n/);
    const helperRange = findFunctionRange(lines, 'registerMjRouterGroup');
    const prefixes = parseGroupPrefixes(lines, helperRange);
    const uniqueRoutes = new Map<string, UpstreamRoute>();

    extractDirectRoutes(lines, source, helperRange, prefixes, uniqueRoutes);
    extractRegisterMjRoutes(lines, source, helperRange, prefixes, uniqueRoutes);

    return [...uniqueRoutes.values()].sort((left, right) => {
        const sourceCompare = left.source.localeCompare(right.source);
        if (sourceCompare !== 0) return sourceCompare;
        return left.line - right.line;
    });
}

function parseMatrixRoute(raw: string, groupId: string): MatrixRoutePattern {
    const [methodsPart, pathPart] = raw.trim().split(/\s+/, 2);
    if (!methodsPart || !pathPart) throw new Error(`Invalid matrix route pattern in ${groupId}: ${raw}`);
    const methods = methodsPart.split('|').map((methodName) => {
        const method = methodFromString(methodName);
        if (!method) throw new Error(`Unsupported HTTP method in ${groupId}: ${raw}`);
        return method;
    });
    return { methods, path: normalizePath(pathPart), raw, groupId };
}

function pathMatches(pattern: string, actual: string): boolean {
    const patternSegments = normalizePath(pattern).split('/').filter(Boolean);
    const actualSegments = normalizePath(actual).split('/').filter(Boolean);

    for (let i = 0; i < patternSegments.length; i += 1) {
        const patternSegment = patternSegments[i];
        const actualSegment = actualSegments[i];
        if (patternSegment.startsWith('*')) return true;
        if (actualSegment === undefined) return false;
        if (patternSegment.startsWith(':')) continue;
        if (patternSegment !== actualSegment) return false;
    }

    return patternSegments.length === actualSegments.length;
}

function matchingPatternsForRoute(route: UpstreamRoute, patterns: readonly MatrixRoutePattern[]): string[] {
    return patterns
        .filter((pattern) => pattern.methods.includes(route.method) && pathMatches(pattern.path, route.path))
        .map((pattern) => `${pattern.groupId}: ${pattern.raw}`);
}

async function writePublicApiSyncReport(reportPath: string, report: PublicApiSyncReport): Promise<void> {
    await ensureParentDir(reportPath);
    await writeJson(reportPath, report);
    console.log(`[new-api-upstream-routes] wrote public API sync report: ${reportPath}`);
}

async function loadUpstreamRoutes(options: Options, matrix: RouteParityMatrix): Promise<{ readonly commit: string; readonly routes: readonly UpstreamRoute[] }> {
    const commit = await resolveUpstreamCommit(options);
    await ensureUpstreamCheckout(options, commit);

    const routesByKey = new Map<string, UpstreamRoute>();
    for (const sourceFile of matrix.sourceSnapshot.evidence) {
        const sourcePath = join(options.cacheDir, sourceFile);
        const routes = extractRoutesFromSource(sourceFile, await readText(sourcePath));
        for (const route of routes) addRoute(routesByKey, route);
    }

    return {
        commit,
        routes: [...routesByKey.values()].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`)),
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const matrix = await readJson<RouteParityMatrix>(matrixPath);
    const patterns = matrix.routeGroups.flatMap((group) => group.routes.map((route) => parseMatrixRoute(route, group.id)));
    const upstream = await loadUpstreamRoutes(options, matrix);
    const coverage = upstream.routes.map((route): RouteCoverage => {
        const coveredBy = matchingPatternsForRoute(route, patterns);
        return { ...route, covered: coveredBy.length > 0, coveredBy };
    });
    const missing = coverage.filter((route) => !route.covered).map(({ covered: _covered, coveredBy: _coveredBy, ...route }) => route);
    const failures: string[] = [];
    const commitDrift = upstream.commit !== matrix.sourceSnapshot.commit;

    if (commitDrift && !options.allowNewerCommit) {
        failures.push(`upstream ${matrix.sourceSnapshot.project} ${options.ref} is ${upstream.commit}, but matrix pins ${matrix.sourceSnapshot.commit}`);
    }

    if (missing.length > 0) {
        failures.push(`${missing.length} upstream route declaration(s) are not covered by docs/new-api-route-parity.matrix.json`);
    }

    if (options.reportPath) {
        await writePublicApiSyncReport(options.reportPath, {
            version: 1,
            generatedAt: new Date().toISOString(),
            upstream: {
                project: matrix.sourceSnapshot.project,
                repoUrl: options.repoUrl,
                ref: options.ref,
                commit: upstream.commit,
                pinnedCommit: matrix.sourceSnapshot.commit,
                pinnedCheckedAt: matrix.sourceSnapshot.checkedAt,
                sourceFiles: matrix.sourceSnapshot.evidence,
            },
            coverage: {
                totalRoutes: coverage.length,
                coveredRoutes: coverage.length - missing.length,
                missingRoutes: missing.length,
                matrixPatterns: patterns.length,
                matrixGroups: matrix.routeGroups.length,
                commitDrift,
            },
            routes: coverage,
            missingRoutes: missing,
        });
    }

    if (failures.length > 0) {
        console.error('[new-api-upstream-routes] drift detected');
        for (const failure of failures) console.error(`- ${failure}`);
        if (missing.length > 0) {
            console.error('[new-api-upstream-routes] missing coverage:');
            for (const route of missing) {
                console.error(`- ${route.method} ${route.path} (${route.source}:${route.line})`);
            }
        }
        console.error('[new-api-upstream-routes] update the route parity matrix and implementation, then rerun this command.');
        process.exit(1);
    }

    console.log(`[new-api-upstream-routes] upstream ${matrix.sourceSnapshot.project}@${upstream.commit}`);
    console.log(`[new-api-upstream-routes] ${upstream.routes.length} upstream route declaration(s) covered by ${patterns.length} matrix pattern(s)`);
    console.log('[new-api-upstream-routes] ok');
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[new-api-upstream-routes] check failed');
    console.error(`- ${message}`);
    console.error('- If GitHub is unavailable, rerun with --offline to validate against the cached reference checkout.');
    process.exit(1);
});
