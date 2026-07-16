const http = require('http');
const fs = require('fs');
const path = require('path');

function postJson(pathName, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = http.request({
            hostname: 'localhost', port: 3001, path: pathName, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, raw: body }); } });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

async function main() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'produtos_pendentes_ion.sql'), 'utf8');

    // 1) Amostra (5 linhas) via test-query
    console.log('--- AMOSTRA (5 linhas) ---');
    const sample = await postJson('/api/campaigns/test-query', { selectQuery: sql });
    if (sample.body && sample.body.columns) {
        console.log('Colunas:', sample.body.columns.join(' | '));
        console.log('Linhas retornadas:', sample.body.rows.length);
        sample.body.rows.forEach((r, i) => console.log(`\n[${i + 1}]`, JSON.stringify(r)));
    } else {
        console.log('ERRO amostra:', JSON.stringify(sample));
        return;
    }

    // 2) Total de linhas + distinct produto/filial (para medir duplicidade)
    const countSql = `SELECT COUNT(*) AS TOTAL_LINHAS,
        COUNT(DISTINCT "Cód Prod." || '-' || "Filial") AS DISTINTOS_PROD_FILIAL,
        SUM(CASE WHEN "Situação Estoque" = 'COM ESTOQUE' THEN 1 ELSE 0 END) AS COM_ESTOQUE,
        COUNT(DISTINCT "Fornecedor") AS FORNECEDORES
        FROM ( ${sql.replace(/;\s*$/, '')} )`;
    console.log('\n--- TOTAIS ---');
    const totals = await postJson('/api/campaigns/test-query', { selectQuery: countSql });
    console.log(JSON.stringify(totals.body && totals.body.rows ? totals.body.rows[0] : totals, null, 2));
}

main().catch(e => console.error('FALHA:', e.message));
