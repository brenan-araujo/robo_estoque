require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- COUNT NON-NULL VALUES IN PCPRODUT ---');
        const countProd = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL,
                COUNT(RUA) AS CONTA_RUA,
                COUNT(PREDIO) AS CONTA_PREDIO,
                COUNT(APTO) AS CONTA_APTO,
                COUNT(RUACX) AS CONTA_RUACX,
                COUNT(PREDIOCX) AS CONTA_PREDIOCX,
                COUNT(APTOCX) AS CONTA_APTOCX
             FROM BRAGO.PCPRODUT`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(countProd.rows);

        console.log('--- SAMPLE OF NON-NULL PREDIO IN PCPRODUT ---');
        const samplePredio = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, RUA, PREDIO, APTO 
                FROM BRAGO.PCPRODUT 
                WHERE PREDIO IS NOT NULL AND PREDIO > 0
            ) WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(samplePredio.rows);

        console.log('--- SAMPLE OF NON-NULL PREDIOCX IN PCPRODUT ---');
        const samplePrediocx = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, RUACX, PREDIOCX, APTOCX 
                FROM BRAGO.PCPRODUT 
                WHERE PREDIOCX IS NOT NULL AND PREDIOCX > 0
            ) WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(samplePrediocx.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
