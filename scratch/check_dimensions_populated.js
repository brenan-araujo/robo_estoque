require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- COUNT POPULATED DIMENSIONS ---');
        const counts = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL,
                COUNT(CASE WHEN ALTURAARM > 0 THEN 1 END) AS CNT_ALTURAARM,
                COUNT(CASE WHEN LARGURAARM > 0 THEN 1 END) AS CNT_LARGURAARM,
                COUNT(CASE WHEN COMPRIMENTOARM > 0 THEN 1 END) AS CNT_COMPRIMENTOARM,
                COUNT(CASE WHEN VOLUMEARM > 0 THEN 1 END) AS CNT_VOLUMEARM,
                COUNT(CASE WHEN PESOBRUTOMASTER > 0 THEN 1 END) AS CNT_PESOBRUTOMASTER,
                COUNT(CASE WHEN PESOLIQMASTER > 0 THEN 1 END) AS CNT_PESOLIQMASTER,
                COUNT(CASE WHEN ALTURAM3 > 0 THEN 1 END) AS CNT_ALTURAM3,
                COUNT(CASE WHEN LARGURAM3 > 0 THEN 1 END) AS CNT_LARGURAM3,
                COUNT(CASE WHEN COMPRIMENTOM3 > 0 THEN 1 END) AS CNT_COMPRIMENTOM3
             FROM BRAGO.PCPRODUT`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(counts.rows);

        console.log('--- SAMPLE OF DIMENSION VALUES ---');
        // Let's sample some rows that have these populated
        const sample = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, QTUNITCX, ALTURAARM, LARGURAARM, COMPRIMENTOARM, VOLUMEARM, PESOBRUTOMASTER
                FROM BRAGO.PCPRODUT 
                WHERE ALTURAARM > 0 OR VOLUMEARM > 0 OR PESOBRUTOMASTER > 0
            ) WHERE ROWNUM <= 15`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(sample.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
