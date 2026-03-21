const fs = require('fs');
const path = require('path');

function scanForChineseComments(dir) {
    let results = [];
    
    function walk(currentDir) {
        const files = fs.readdirSync(currentDir);
        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            
            // Skip node_modules, build, dist, .svelte-kit, .git
            if (['node_modules', 'build', 'dist', '.svelte-kit', '.git'].includes(file)) {
                continue;
            }
            
            if (fs.statSync(fullPath).isDirectory()) {
                walk(fullPath);
            } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.svelte') || fullPath.endsWith('.sql')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                
                // Matches // comments with Chinese
                const singleLineRegex = /(?:\/\/|--)[^\n]*[\u4e00-\u9fa5][^\n]*/g;
                // Matches /* */ comments with Chinese
                const multiLineRegex = /\/\*[\s\S]*?[\u4e00-\u9fa5][\s\S]*?\*\//g;
                
                let matches = [];
                let m;
                
                while ((m = singleLineRegex.exec(content)) !== null) {
                    matches.push({ type: 'single', match: m[0] });
                }
                while ((m = multiLineRegex.exec(content)) !== null) {
                    matches.push({ type: 'multi', match: m[0] });
                }
                
                if (matches.length > 0) {
                    results.push({
                        file: fullPath,
                        matches: matches
                    });
                }
            }
        }
    }
    
    walk(dir);
    return results;
}

const res = [
    ...scanForChineseComments(path.join(__dirname, 'apps/gateway/src')),
    ...scanForChineseComments(path.join(__dirname, 'apps/web/src')),
    ...scanForChineseComments(path.join(__dirname, 'packages/db/src'))
];

console.log(JSON.stringify(res, null, 2));
