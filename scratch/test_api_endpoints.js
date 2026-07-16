const http = require('http');

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log('--- TESTING BACKEND ENDPOINTS ---');
    try {
        console.log('Testing /api/logistics/kpis for filial 20 + 6...');
        const res = await getJson('http://localhost:3001/api/logistics/kpis?filial=20%20%2B%206');
        console.log('Status:', res.status);
        if (res.status === 200) {
            console.log('Success! KPIs:', res.body.kpis);
            console.log('Cronograma:', res.body.cronograma);
            console.log('Top Fornecedores:', res.body.topFornecedores);
            console.log('Urgentes Count:', res.body.alertas.urgenciaRecebimento.length);
        } else {
            console.error('Failed with status:', res.status, res.body || res.raw);
        }
    } catch (err) {
        console.error('Error connecting to server:', err.message);
    }
}

// Wait 4 seconds for the server to start, then run
setTimeout(main, 4000);
