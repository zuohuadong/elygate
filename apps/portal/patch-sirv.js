// Patch sirv for Bun adapter compatibility.
// The adapter output uses sirv for static file serving; this script ensures
// the production build works with svelte-adapter-bun without modification.
// If no patching is needed this is a no-op.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const serverEntry = join(import.meta.dirname, '.svelte-kit', 'output', 'server', 'index.js');
if (!existsSync(serverEntry)) {
    console.log('patch-sirv: no server entry found, skipping');
    process.exit(0);
}

let content = readFileSync(serverEntry, 'utf-8');
if (content.includes('sirv') && !content.includes('sirv/bun')) {
    content = content.replace(/from\s+['"]sirv['"]/g, "from 'sirv/bun'");
    writeFileSync(serverEntry, content);
    console.log('patch-sirv: patched sirv import for Bun');
} else {
    console.log('patch-sirv: no patching needed');
}
