const fs = require('fs');
const path = require('path');

function escapeFile(filePath) {
    console.log(`Processing file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Replace non-ASCII characters with Unicode escape sequence \uXXXX
    let escapedContent = '';
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const code = char.charCodeAt(0);
        if (code > 127) {
            const hex = code.toString(16).padStart(4, '0');
            escapedContent += `\\u${hex}`;
            console.log(`  Escaped '${char}' (code ${code}) to '\\u${hex}'`);
        } else {
            escapedContent += char;
        }
    }
    
    fs.writeFileSync(filePath, escapedContent, 'utf8');
    console.log(`Successfully saved: ${filePath}\n`);
}

const files = [
    path.join(__dirname, '..', 'src', 'services', 'ruptureReportService.js'),
    path.join(__dirname, '..', 'src', 'server.js')
];

files.forEach(file => {
    if (fs.existsSync(file)) {
        escapeFile(file);
    } else {
        console.error(`File not found: ${file}`);
    }
});
