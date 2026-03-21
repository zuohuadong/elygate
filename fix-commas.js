const fs = require('fs');
const path = require('path');

function addCommas(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
        const p = path.join(dir, file);
        if (fs.statSync(p).isDirectory()) {
            if (p.includes('plugins')) addCommas(p);
        } else if (p.endsWith('.ts')) {
            let src = fs.readFileSync(p, 'utf8');
            const lines = src.split('\n');
            let modified = false;

            for (let i = 1; i < lines.length; i++) {
                // If current line is a method definition inside the object
                // Looks like: `    methodName(...)` or `    async methodName(...)` or `    private static async methodName(...)`
                if (lines[i].match(/^\s+(?:async\s+)?(?:private\s+)?(?:static\s+)?\w+\s*\(/)) {
                    // Find the previous non-empty line
                    let prevIdx = i - 1;
                    while (prevIdx >= 0 && lines[prevIdx].trim() === '') {
                        prevIdx--;
                    }
                    if (prevIdx >= 0 && lines[prevIdx].trim() === '}') {
                        lines[prevIdx] = lines[prevIdx].replace('}', '},');
                        modified = true;
                    }
                }
            }

            if (modified) {
                fs.writeFileSync(p, lines.join('\n'));
                console.log('Fixed commas in:', p);
            }
        }
    });
}

addCommas(path.join(__dirname, 'apps/gateway/src/providers'));
addCommas(path.join(__dirname, 'apps/gateway/src/services'));
