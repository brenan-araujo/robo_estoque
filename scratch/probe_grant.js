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
    if (r.rows) { if (!r.rows.length) console.log('(vazio)'); r.rows.forEach(row => console.log(JSON.stringify(row))); }
    else console.log('ERR:', JSON.stringify(r).slice(0, 200));
}
async function main() {
    // Existe o pacote em QUALQUER schema? (precisa de acesso a DBA_OBJECTS)
    await q('DBA_OBJECTS PKG_ESTOQUE', `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, STATUS FROM DBA_OBJECTS WHERE OBJECT_NAME = 'PKG_ESTOQUE'`);
    // Visivel via ALL_OBJECTS (o que COMODATO enxerga)?
    await q('ALL_OBJECTS PKG_ESTOQUE', `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OBJECT_NAME = 'PKG_ESTOQUE'`);
    // Ja existe algum grant de EXECUTE para COMODATO?
    await q('privs EXECUTE recebidos', `SELECT OWNER, TABLE_NAME, PRIVILEGE FROM ALL_TAB_PRIVS WHERE GRANTEE = USER AND PRIVILEGE = 'EXECUTE' AND TABLE_NAME LIKE '%ESTOQUE%'`);
}
main().catch(e => console.error('FALHA:', e.message));
