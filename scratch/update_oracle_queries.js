const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'services', 'oracleService.js');
let content = fs.readFileSync(file, 'utf8');

// Perform the replacements
const originalLength = content.length;
content = content.replace(/M\.CODFILIAL\s*=\s*'20'/g, "M.CODFILIAL IN ('20', '6')");
content = content.replace(/M\.CODFILIAL\s*<>\s*'20'/g, "M.CODFILIAL NOT IN ('20', '6')");

if (content.length !== originalLength) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Successfully replaced all occurrences in oracleService.js!');
} else {
    console.warn('⚠️ No replacements made. Check if patterns match.');
}
