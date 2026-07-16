const fs = require('fs');
const path = require('path');

function findPngs(dir, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (stat.isDirectory()) {
        results = results.concat(findPngs(filePath, maxDepth, currentDepth + 1));
      } else if (filePath.toLowerCase().endsWith('.png')) {
        results.push({ path: filePath, size: stat.size, mtime: stat.mtime });
      }
    }
  } catch (e) {
    // ignore
  }
  return results;
}

const searchDirs = [
  'C:\\Users\\usuario001\\AppData\\Local\\Temp',
  'C:\\Users\\usuario001\\Documents\\api_consulta_estoque',
  'C:\\Users\\usuario001\\.gemini'
];

let allPngs = [];
for (const d of searchDirs) {
  console.log(`Searching ${d}...`);
  allPngs = allPngs.concat(findPngs(d));
}

// Sort by modified time descending
allPngs.sort((a, b) => b.mtime - a.mtime);

console.log("Found PNGs:");
allPngs.slice(0, 15).forEach(p => {
  console.log(`${p.path} (${p.size} bytes) - Modified: ${p.mtime}`);
});
