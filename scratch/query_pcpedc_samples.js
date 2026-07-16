require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- SAMPLE RECORDS FROM PCPEDC ---');
        const res = await conn.execute(
            `SELECT NUMPED, DATA, DTCANCEL, POSICAO, CODFILIAL 
             FROM PCPEDC 
             WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(res.rows);

        console.log('--- UNIQUE POSITIONS IN PCPEDC ---');
        const pos = await conn.execute(
            `SELECT POSICAO, COUNT(*) AS QTY 
             FROM PCPEDC 
             GROUP BY POSICAO`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pos.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
