const fs = require('fs');
const path = require('path');

const packagesToUpdate = [
    'package.json',
    'apps/gateway/package.json',
    'apps/portal/package.json',
    'apps/web/package.json',
    'packages/db/package.json',
    'packages/pg-listen/package.json'
];

let successCount = 0;

for (const relPath of packagesToUpdate) {
    const fullPath = path.join(__dirname, relPath);
    if (!fs.existsSync(fullPath)) continue;
    
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Naive bump 0.5.3 to 0.5.4
    const prevVersion = '"version": "0.5.3"';
    const nextVersion = '"version": "0.5.4"';
    
    if (content.includes(prevVersion)) {
        content = content.replace(prevVersion, nextVersion);
        fs.writeFileSync(fullPath, content);
        console.log(`Bumped version in ${relPath}`);
        successCount++;
    } else {
        console.log(`WARNING: Version 0.5.3 not found in ${relPath}. Current content:`, content.split('\n').filter(l => l.includes('"version"'))[0]);
    }
}
console.log(`Success: bumped ${successCount} files.`);
