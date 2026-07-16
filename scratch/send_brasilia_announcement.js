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
    console.log('🚀 Enviando anúncio para o grupo de Brasília...');
    const message = `Olá, Comercial Brasília! 😊

Passando para dar um "oi" e dizer que agora estou oficialmente no grupo de vocês! 🌟

Minha missão aqui é somar, trazer novidades e facilitar a comunicação de vocês. Contem comigo para apoiar a equipe no que for preciso!

Vamos juntos rumo a grandes resultados e crescer cada vez mais! Boas vendas! 🚀📈`;

    const payload = {
        target: 'BRAGO Vendas Comercial Brasília',
        message: message,
        isGroup: true
    };

    try {
        const res = await postJson('http://localhost:3001/api/whatsapp/send-message', payload);
        console.log('Status HTTP:', res.status);
        console.log('Resposta do Servidor:', res.body || res.raw);
    } catch (err) {
        console.error('❌ Erro ao conectar ao servidor:', err.message);
    }
}

main();
