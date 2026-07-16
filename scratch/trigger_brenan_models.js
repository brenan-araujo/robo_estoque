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
    console.log('🚀 Iniciando envio dos 2 modelos para os números do Brenan...');

    try {
        // Modelo 1: Sexta-Feira (Previsão próxima semana + Snapshot)
        console.log('\n--- 1. Enviando Modelo de Sexta-Feira (Próxima Semana)...');
        const resFriday = await postJson('http://localhost:3001/api/logistics/send-whatsapp', { isFriday: true });
        console.log('Status HTTP:', resFriday.status);
        console.log('Resposta:', resFriday.body || resFriday.raw);

        // Aguarda 10 segundos para o envio completo e delay seguro
        console.log('Aguardando 10 segundos antes de enviar o segundo modelo...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Modelo 2: Quarta-Feira (Previsão atualizada + Alterações comparadas)
        console.log('\n--- 2. Enviando Modelo de Quarta-Feira (Alterações comparadas)...');
        const resWednesday = await postJson('http://localhost:3001/api/logistics/send-whatsapp', { isFriday: false });
        console.log('Status HTTP:', resWednesday.status);
        console.log('Resposta:', resWednesday.body || resWednesday.raw);

        console.log('\n✅ Envio concluído!');
    } catch (err) {
        console.error('❌ Erro durante o disparo:', err.message);
    }
}

main();
