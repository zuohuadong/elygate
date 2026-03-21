const fs = require('fs');
const path = require('path');

function processProvider(p) {
    if (!fs.existsSync(p)) return;
    let src = fs.readFileSync(p, 'utf8');
    
    // Replace class with object
    src = src.replace(/export class (\w+) implements ProviderHandler \{/, (match, className) => {
        return `export const ${className}: ProviderHandler = {\n    transformRequest,\n    transformResponse,\n    extractUsage,\n    buildHeaders\n};\n`;
    });

    // Replace methods
    src = src.replace(/^\s*(?:public\s+|private\s+|static\s+)?(async\s+)?(transformRequest|transformResponse|extractUsage|buildHeaders)\s*\(/gm, '$1function $2(');

    // Remove last }
    src = src.replace(/\}\s*$/, '');
    
    fs.writeFileSync(p, src);
}

function processConverters(p) {
    let src = fs.readFileSync(p, 'utf8');
    
    src = src.replace(/export class (\w+) implements FormatConverter \{/g, (match, className) => {
        return `export const ${className}: FormatConverter = {\n    convertRequest,\n    convertResponse,\n    convertStreamChunk,\n    convertError\n};\n`;
    });

    src = src.replace(/^\s*(?:public\s+|private\s+|static\s+)?(async\s+)?(convertRequest|convertResponse|convertStreamChunk|convertError)\s*\(/gm, '$1function $2(');

    // Remove all trailing } for classes
    // Because converters.ts has multiple classes, we can't just strip the end of file.
    // Instead of doing this via regex which is messy, we can just replace the class's ending } 
    // Wait, regex to remove class ending `}`:
    // This is hard. But wait! If we extract `export const X = { ... }` and convert all `convertX` to `function convertX`, we will have multiple `function convertX` in the SAME FILE. That is a syntax error! You can't have 11 `function convertRequest` in the same scope!
