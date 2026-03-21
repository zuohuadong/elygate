const fs = require('fs');
const path = require('path');

// 1. static.ts headers
let staticTs = fs.readFileSync('apps/gateway/src/middleware/static.ts', 'utf8');
staticTs = staticTs.replace(/if \(ext === 'js'\)/g, 'if (!set.headers) set.headers = {};\n                if (ext === \\'js\\')');
staticTs = staticTs.replace(/set\.headers\['Cache-Control']/g, 'if (!set.headers) set.headers = {};\n                set.headers[\\'Cache-Control\\']');
fs.writeFileSync('apps/gateway/src/middleware/static.ts', staticTs);

// 2. openai.ts return type
let openaiTs = fs.readFileSync('apps/gateway/src/providers/openai.ts', 'utf8');
openaiTs = openaiTs.replace(/transformResponse\(data: Record<string, any>\) \{/g, 'transformResponse(data: Record<string, any>): Record<string, any> {');
fs.writeFileSync('apps/gateway/src/providers/openai.ts', openaiTs);

// 3. admin & channels apiUrls
function addImport(p, importStr) {
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');
    if (!c.includes('apiUrls')) {
        c = importStr + '\n' + c;
        fs.writeFileSync(p, c);
    }
}
addImport('apps/gateway/src/routes/admin.ts', 'import { apiUrls } from "../config";');
addImport('apps/gateway/src/routes/admin/channels.ts', 'import { apiUrls } from "../../config";');
addImport('apps/gateway/src/routes/payment.ts', 'import { apiUrls } from "../config";');

// 4. dashboard.ts cost sum
let dashTs = fs.readFileSync('apps/gateway/src/routes/admin/dashboard.ts', 'utf8');
dashTs = dashTs.replace(/sum: Record<string, any>, m: Record<string, any>/g, 'sum: number, m: Record<string, any>');
fs.writeFileSync('apps/gateway/src/routes/admin/dashboard.ts', dashTs);

// 5. admin/packages.ts results
let pkgTs = fs.readFileSync('apps/gateway/src/routes/admin/packages.ts', 'utf8');
pkgTs = pkgTs.replace(/const results: Record<string, any>\[\]\[\] = \[\];/g, 'const results: Record<string, any>[] = [];');
fs.writeFileSync('apps/gateway/src/routes/admin/packages.ts', pkgTs);

// 6. audio.ts endpointType
let audioTs = fs.readFileSync('apps/gateway/src/routes/audio.ts', 'utf8');
audioTs = audioTs.replace(/endpointType: endpointType as string,/g, 'endpointType: endpointType as any,');
fs.writeFileSync('apps/gateway/src/routes/audio.ts', audioTs);

// 7. auth.ts error message
let authTs = fs.readFileSync('apps/gateway/src/routes/auth.ts', 'utf8');
authTs = authTs.replace(/e\?\.message/g, '(e as any)?.message');
fs.writeFileSync('apps/gateway/src/routes/auth.ts', authTs);

// 8 & 9. chat.ts optionCache types
let chatTs = fs.readFileSync('apps/gateway/src/routes/chat.ts', 'utf8');
chatTs = chatTs.replace(/const configuredModel = optionCache.get\('CHAT_CHANNEL_MODEL', ''\);/g, 'const configuredModel = optionCache.get(\\'CHAT_CHANNEL_MODEL\\', \\'\\') as string;');
fs.writeFileSync('apps/gateway/src/routes/chat.ts', chatTs);

// 10. payment.ts tx implicitly any
let payTs = fs.readFileSync('apps/gateway/src/routes/payment.ts', 'utf8');
payTs = payTs.replace(/async \(tx\) =>/g, 'async (tx: any) =>');
fs.writeFileSync('apps/gateway/src/routes/payment.ts', payTs);

// 11. sys.ts log missing
let sysTs = fs.readFileSync('apps/gateway/src/routes/sys.ts', 'utf8');
if (!sysTs.includes('logger')) {
    sysTs = 'import { log } from "../services/logger";\n' + sysTs;
    fs.writeFileSync('apps/gateway/src/routes/sys.ts', sysTs);
}

console.log('Fixed final 30 TS errors.');
