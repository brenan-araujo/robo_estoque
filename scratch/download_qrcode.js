const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js';
const dest = path.join(__dirname, '..', 'src', 'public', 'qrcode.min.js');

console.log(`Downloading ${url} to ${dest}...`);

const file = fs.createWriteStream(dest);
https.get(url, (response) => {
    response.pipe(file);
    file.on('finish', () => {
        file.close();
        console.log('Download completed successfully!');
        process.exit(0);
    });
}).on('error', (err) => {
    fs.unlink(dest, () => {});
    console.error(`Error downloading file: ${err.message}`);
    process.exit(1);
});
