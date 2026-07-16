const fs = require('fs');
const path = require('path');

const links = new Set();

const files = [
    'C:\\Users\\usuario001\\.gemini\\antigravity\\brain\\f45390fc-313b-452e-b1e7-d0819236543d\\.system_generated\\steps\\94\\content.md',
    'C:\\Users\\usuario001\\.gemini\\antigravity\\brain\\f45390fc-313b-452e-b1e7-d0819236543d\\.system_generated\\steps\\104\\content.md'
];

files.forEach(filePath => {
    if (fs.existsSync(filePath)) {
        const html = fs.readFileSync(filePath, 'utf8');
        const regex = /href="(https:\/\/softworksepi\.com\.br\/produtos\/[^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const url = match[1];
            if (!url.includes('/page/') && !url.endsWith('/feed/') && !url.includes('?page=')) {
                links.add(url);
            }
        }
    }
});

console.log('All unique Product Links:');
console.log(JSON.stringify(Array.from(links), null, 2));
console.log(`Total: ${links.size} products.`);
