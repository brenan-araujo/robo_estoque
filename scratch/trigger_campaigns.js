const http = require('http');

function postJson(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = http.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Length': '0'
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
        req.end();
    });
}

const campaignIds = [
    'camp-1782403173679', // DF
    'camp-1782503421133', // GO
    'camp-1782503545681'  // TO
];

async function main() {
    console.log('🚀 Disparando as 3 campanhas da Bom Princípio...');
    
    for (const id of campaignIds) {
        console.log(`\nDisparando campanha: ${id}...`);
        try {
            const res = await postJson(`http://localhost:3001/api/campaigns/${id}/trigger`);
            console.log('Status HTTP:', res.status);
            console.log('Resposta do Servidor:', res.body || res.raw);
        } catch (err) {
            console.error(`❌ Erro ao disparar campanha ${id}:`, err.message);
        }
    }
    
    console.log('\n🏁 Disparo de campanhas concluído.');
}

main();
