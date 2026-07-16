const http = require('http');
const { exec } = require('child_process');

function controlMonitor(action) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ action });
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: '/api/control',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve({ success: true, data: JSON.parse(body) });
                } else {
                    resolve({ success: false, error: `Status ${res.statusCode}: ${body}` });
                }
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        req.write(data);
        req.end();
    });
}

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        console.log(`Running: ${cmd}`);
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(stderr);
                reject(error);
            } else {
                console.log(stdout);
                resolve();
            }
        });
    });
}

async function main() {
    console.log('🛑 Parando o monitor temporariamente...');
    await controlMonitor('stop');
    
    // Aguarda 3 segundos
    await new Promise(r => setTimeout(r, 3000));
    
    try {
        console.log('🚀 Executando teste de envio de corte real...');
        await runCommand('node scratch/test_cut_notifications.js --send --reset');
    } catch (e) {
        console.error('Falha ao enviar mensagens:', e.message);
    } finally {
        console.log('🔄 Reiniciando o monitor...');
        await controlMonitor('start');
        process.exit(0);
    }
}

main();
