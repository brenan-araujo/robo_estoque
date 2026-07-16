const http = require('http');
const fs = require('fs');
const path = require('path');
function postJson(pathName, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = http.request({ hostname: 'localhost', port: 3001, path: pathName, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
            (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>{try{resolve(JSON.parse(b))}catch{resolve({raw:b})}}); });
        req.on('error', reject); req.write(data); req.end();
    });
}
async function q(label, sql) {
    console.log(`\n=== ${label} ===`);
    const r = await postJson('/api/campaigns/test-query', { selectQuery: sql });
    if (r.rows) r.rows.forEach(row => console.log(JSON.stringify(row)));
    else console.log('ERR:', JSON.stringify(r).slice(0, 300));
}
async function main() {
    // v1 = 1 linha por produto x filial, FALTA_REVISAR, TODAS as situações de estoque
    const base = fs.readFileSync(path.join(__dirname, '..', 'sql', 'produtos_pendentes_ion.sql'), 'utf8').replace(/;\s*$/, '');

    await q('Distribuição por produto', `
        WITH B AS ( ${base} ),
        P AS (
            SELECT "Cód Prod." CP,
                COUNT(*) NFIL,
                MAX(CASE WHEN "Situação Estoque"='COM ESTOQUE' THEN 1 ELSE 0 END) TEM_ESTOQUE,
                SUM(CASE WHEN "Situação Estoque"='COM ESTOQUE' THEN 1 ELSE 0 END) NFIL_COM_ESTOQUE
            FROM B GROUP BY "Cód Prod."
        )
        SELECT
            COUNT(*) PRODUTOS_PENDENTES,
            SUM(CASE WHEN NFIL>1 THEN 1 ELSE 0 END) PROD_MULTIFILIAL,
            SUM(TEM_ESTOQUE) PROD_COM_ESTOQUE_ALGUMA,
            SUM(CASE WHEN TEM_ESTOQUE=1 AND NFIL>1 THEN 1 ELSE 0 END) COM_ESTOQUE_E_MULTIFILIAL,
            SUM(CASE WHEN NFIL_COM_ESTOQUE>1 THEN 1 ELSE 0 END) MULTIFILIAL_TODAS_COM_ESTOQUE
        FROM P`);

    // Exemplos: produtos COM estoque em alguma filial e pendentes em >1 filial
    await q('Exemplos multi-filial (com estoque em alguma)', `
        WITH B AS ( ${base} ),
        P AS (
            SELECT "Cód Prod." CP, COUNT(*) NFIL,
                MAX(CASE WHEN "Situação Estoque"='COM ESTOQUE' THEN 1 ELSE 0 END) TEM_ESTOQUE
            FROM B GROUP BY "Cód Prod."
        )
        SELECT * FROM (
            SELECT CP, NFIL FROM P WHERE TEM_ESTOQUE=1 AND NFIL>1 ORDER BY NFIL DESC
        ) WHERE ROWNUM <= 8`);
}
main().catch(e => console.error('FALHA:', e.message));
