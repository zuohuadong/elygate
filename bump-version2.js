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
    
    // Find the current version
    const versionMatch = content.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/);
    if (versionMatch) {
        const major = versionMatch[1];
        const minor = versionMatch[2];
        const patch = parseInt(versionMatch[3]);
        const nextVersion = `${major}.${minor}.${patch + 1}`;
        
        content = content.replace(versionMatch[0], `"version": "${nextVersion}"`);
        fs.writeFileSync(fullPath, content);
        console.log(`Bumped version in ${relPath} to ${nextVersion}`);
        successCount++;
    } else {
        console.log(`WARNING: Version not found in ${relPath}`);
    }
}
console.log(`Success: bumped ${successCount} files.`);
