require('dotenv').config();
const db = require('../src/config/database');

async function main() {
    await db.initialize();
    let conn;
    try {
        conn = await db.getConnection();

        // 1) Colunas da PCREGIAO
        const cols = await conn.execute(
            `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCREGIAO' ORDER BY COLUMN_ID`,
            [], { outFormat: db.oracledb.OUT_FORMAT_OBJECT });
        console.log('Colunas PCREGIAO:', cols.rows.map(r => r.COLUMN_NAME).join(', '));

        // 2) Dump das regiões relevantes (normais vs as do print: 24/31/33)
        const dump = await conn.execute(
            `SELECT * FROM PCREGIAO WHERE CODFILIAL IN (20,21) AND NUMREGIAO IN (1,2,5,6,24,31,33,37,41) ORDER BY CODFILIAL, NUMREGIAO`,
            [], { outFormat: db.oracledb.OUT_FORMAT_OBJECT });
        console.log('\nRegiões (filiais 20/21):');
        dump.rows.forEach(r => {
            console.log(`\n região ${r.NUMREGIAO} (filial ${r.CODFILIAL}):`);
            Object.entries(r).forEach(([k, v]) => {
                if (v !== null && v !== '' && !['NUMREGIAO', 'CODFILIAL'].includes(k)) {
                    console.log(`     ${k} = ${v instanceof Date ? v.toISOString().slice(0,10) : v}`);
                }
            });
        });
    } finally {
        if (conn) { try { await conn.close(); } catch (e) {} }
        await db.close();
    }
}
main().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
