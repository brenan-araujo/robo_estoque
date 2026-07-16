const http = require('http');
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
    await q('current user', `SELECT USER AS CURRENT_USER FROM DUAL`);
    await q('procedures named ESTOQUE_DISPONIVEL', `SELECT OWNER, OBJECT_NAME, PROCEDURE_NAME FROM ALL_PROCEDURES WHERE PROCEDURE_NAME = 'ESTOQUE_DISPONIVEL' OR OBJECT_NAME = 'ESTOQUE_DISPONIVEL'`);
    await q('objects like PKG_ESTOQUE', `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OBJECT_NAME LIKE '%ESTOQUE%' AND OBJECT_TYPE IN ('PACKAGE','FUNCTION','SYNONYM')`);
}
main().catch(e => console.error('FALHA:', e.message));
