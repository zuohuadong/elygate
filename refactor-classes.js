const fs = require('fs');
const path = require('path');

function refactorDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
        const p = path.join(dir, file);
        if (fs.statSync(p).isDirectory()) {
            if (p.includes('plugins')) refactorDir(p);
        } else if (p.endsWith('.ts')) {
            let src = fs.readFileSync(p, 'utf8');
            let modified = false;

            // 1. Providers
            if (src.match(/export class \w+ implements ProviderHandler \{/)) {
                src = src.replace(/export class (\w+) implements ProviderHandler \{/g, 'export const $1: ProviderHandler = {');
                modified = true;
            }

            // 2. Converters
            if (src.match(/export class \w+ implements FormatConverter \{/)) {
                src = src.replace(/export class (\w+) implements FormatConverter \{/g, 'export const $1: FormatConverter = {');
                modified = true;
            }

            // 3. Filter
            if (src.match(/export class ContentFilter \{/)) {
                src = src.replace(/export class ContentFilter \{/g, 'export const ContentFilter = {');
                modified = true;
            }

            // 4. Search
            if (src.match(/export class WebSearchPlugin \{/)) {
                src = src.replace(/export class WebSearchPlugin \{/g, 'export const WebSearchPlugin = {');
                modified = true;
            }

            if (modified) {
                // Now, convert the methods inside the object literal into comma-separated properties.
                // Since this is tricky with regex (methods don't have commas), we can just let TS/JS format handle it 
                // wait, object literals MUST have commas between methods:
                // export const Obj = { method1() {}, method2() {} }
                // So we need to add commas after `}` that are followed by method definitions.
                // A method definition looks like `\n    methodName(` or `\n    async methodName(`.
                // Let's do a simple replace: `}\n\n    ` -> `},\n\n    `
                // Actually, just find the end of methods:
                // `}\n    async ` -> `},\n    async `
                // `}\n    \w+\(` -> `},\n    \w+\(`
                src = src.replace(/\}\n(\s*)(async )?(\w+)\(/g, '},\n$1$2$3(');
                src = src.replace(/\}\n\n(\s*)(async )?(\w+)\(/g, '},\n\n$1$2$3(');

                fs.writeFileSync(p, src);
                console.log('Refactored:', p);
            }
        }
    });
}

refactorDir(path.join(__dirname, 'apps/gateway/src/providers'));
refactorDir(path.join(__dirname, 'apps/gateway/src/services'));
