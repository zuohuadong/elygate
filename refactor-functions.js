const fs = require('fs');
const path = require('path');

function processFile(p, typeName, methods) {
    let src = fs.readFileSync(p, 'utf8');
    if (!src.includes(`implements ${typeName} {`)) return;

    // 1. Find class name
    const match = src.match(new RegExp(`export class (\\w+) implements ${typeName} \\{`));
    if (!match) return;
    const className = match[1];

    // 2. Replace class declaration with object export
    const exportStatement = `export const ${className}: ${typeName} = {\n    ` + methods.join(',\n    ') + `\n};\n`;
    src = src.replace(new RegExp(`export class ${className} implements ${typeName} \\{`), exportStatement);

    // 3. Replace method signatures with 'function '
    // Note: methods have 4 spaces.
    // e.g. "    transformRequest(" -> "function transformRequest("
    // e.g. "    async transformResponse(" -> "async function transformResponse("
    // Remove "public ", "private ", "static " if present
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // Match exact 4 spaces, optional modifiers, async, method name, opening parenthesis
        const m = lines[i].match(/^    (?:public\s+|private\s+|static\s+)?(async\s+)?([a-zA-Z0-9_]+)\s*\((.*)/);
        if (m) {
            // Only convert if it's one of our target methods
            const asyncMod = m[1] || '';
            const methodName = m[2];
            const rest = m[3];
            if (methods.includes(methodName) || methodName === 'searchSerper' || methodName === 'searchBrave' || methodName === 'extractText') {
                lines[i] = `${asyncMod}function ${methodName}(${rest}`;
            }
        }
    }

    // 4. Remove the final closing brace of the class
    // It should be a single '}' at the end of the file or near it
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i] === '}') {
            lines[i] = '';
            break;
        }
    }

    fs.writeFileSync(p, lines.join('\n'));
    console.log(`Refactored ${p}`);
}

const providerMethods = ['transformRequest', 'transformResponse', 'extractUsage', 'buildHeaders'];
const converterMethods = ['convertRequest', 'convertResponse', 'convertStreamChunk', 'convertError'];

function run() {
    const providersDir = path.join(__dirname, 'apps/gateway/src/providers');
    fs.readdirSync(providersDir).forEach(file => {
        if (file.endsWith('.ts')) {
            processFile(path.join(providersDir, file), 'ProviderHandler', providerMethods);
        }
    });

    const convertersFile = path.join(__dirname, 'apps/gateway/src/services/converters.ts');
    processFile(convertersFile, 'FormatConverter', converterMethods);

    // Hardcode for filter and search since they don't 'implement' an interface
    // filter
    let filter = fs.readFileSync(path.join(__dirname, 'apps/gateway/src/services/filter.ts'), 'utf8');
    if (filter.includes('export class ContentFilter {')) {
        filter = filter.replace('export class ContentFilter {', `export const ContentFilter = {\n    validateRequest,\n    validateResponse,\n    extractText\n};\n`);
        filter = filter.replace(/^    (?:public\s+|private\s+|static\s+)?(async\s+)?(validateRequest|validateResponse|extractText)\s*\(/gm, '$1function $2(');
        filter = filter.replace(/}$/, ''); // very naive 
        fs.writeFileSync(path.join(__dirname, 'apps/gateway/src/services/filter.ts'), filter);
        console.log('Refactored filter.ts');
    }

    // search
    let search = fs.readFileSync(path.join(__dirname, 'apps/gateway/src/services/plugins/search.ts'), 'utf8');
    if (search.includes('export class WebSearchPlugin {')) {
        search = search.replace('export class WebSearchPlugin {', `export const WebSearchPlugin = {\n    execute,\n    searchSerper,\n    searchBrave\n};\n`);
        search = search.replace(/^    (?:public\s+|private\s+|static\s+)?(async\s+)?(execute|searchSerper|searchBrave)\s*\(/gm, '$1function $2(');
        search = search.replace(/}$/, ''); 
        fs.writeFileSync(path.join(__dirname, 'apps/gateway/src/services/plugins/search.ts'), search);
        console.log('Refactored search.ts');
    }
}

run();
