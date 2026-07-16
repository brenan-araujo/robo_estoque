const fs = require('fs');
const path = require('path');

function searchDirectory(dir, targetName, maxDepth = 6, currentDepth = 0) {
    if (currentDepth > maxDepth) return [];
    
    let results = [];
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            let stats;
            try {
                stats = fs.statSync(fullPath);
            } catch (e) {
                continue; // Skip files with permission issues
            }
            
            if (stats.isDirectory()) {
                const lowerName = file.toLowerCase();
                
                // Exclude common large system/dev folders
                const excludedFolders = [
                    'windows', 'program files', 'program files (x86)', 'programdata',
                    'appdata', 'node_modules', '.git', '.vscode', 'wamp64', 'xampp',
                    '$recycle.bin', 'inetpub', 'system volume information', 'logs',
                    'cache', '.antigravity', '.claude'
                ];
                
                if (excludedFolders.includes(lowerName)) {
                    continue;
                }
                
                // Check if directory matches
                if (lowerName.includes('fotos') && lowerName.includes('produt')) {
                    results.push(fullPath);
                }
                
                results = results.concat(searchDirectory(fullPath, targetName, maxDepth, currentDepth + 1));
            }
        }
    } catch (e) {
        // Ignore read errors
    }
    return results;
}

const rootDir = 'C:\\';
console.log(`Searching for folders containing "fotos" and "produt" in ${rootDir}...`);
const found = searchDirectory(rootDir, 'fotos produtos');
console.log('Results:');
console.log(JSON.stringify(found, null, 2));
