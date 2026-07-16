const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const version = '2.3000.1040549582-alpha.html';

console.log('Testing fresh WhatsApp Web with version:', version);

const client = new Client({
    // Use a fresh auth directory to avoid using existing session
    authStrategy: new LocalAuth({ clientId: 'fresh_test_session' }),
    webVersionCache: {
        type: 'remote',
        remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${version}`
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR Received! Successfully bypassed initialization error!');
    client.destroy();
    process.exit(0);
});

client.on('ready', () => {
    console.log('Client is ready!');
    client.destroy();
});

client.on('auth_failure', (msg) => {
    console.error('AUTHENTICATION FAILURE', msg);
});

console.log('Initializing client...');
client.initialize().then(() => {
    console.log('Initialize promise resolved!');
}).catch(err => {
    console.error('Initialize failed with error:', err);
    process.exit(1);
});
