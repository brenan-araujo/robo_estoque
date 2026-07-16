const fs = require('fs');
const path = require('path');

console.time('Read app.log');
const logFile = path.join(__dirname, '..', 'logs', 'app.log');
if (fs.existsSync(logFile)) {
    const data = fs.readFileSync(logFile, 'utf8');
    const lines = data.split('\n');
    console.timeEnd('Read app.log');
    console.log(`Lines: ${lines.length}, bytes: ${data.length}`);
} else {
    console.log('Log file not found');
}
