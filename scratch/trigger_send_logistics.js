const http = require('http');

function postJson(url, payload) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const data = JSON.stringify(payload);
        
        const req = http.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });
        
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    console.log('🚀 Enviando solicitação para disparar relatório logístico via WhatsApp...');
    try {
        const payload = {
            filial: '20 + 6',
            numbers: ['5561983391951', '5562996101684']
        };
        const res = await postJson('http://localhost:3001/api/logistics/send-whatsapp', payload);
        console.log('Status HTTP:', res.status);
        console.log('Resposta do Servidor:', res.body || res.raw);
    } catch (err) {
        console.error('❌ Erro ao conectar ao servidor:', err.message);
    }
}

// Aguarda 10 segundos para dar tempo do WhatsApp se conectar no novo processo do servidor
console.log('Aguardando 10 segundos para conexão do WhatsApp...');
setTimeout(main, 10000);
