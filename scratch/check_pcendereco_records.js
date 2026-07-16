require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- PCENDERECO RECORD COUNT ---');
        const countRes = await conn.execute(
            `SELECT COUNT(*) AS CNT, COUNT(CODPROD) AS CNT_PROD FROM BRAGO.PCENDERECO`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(countRes.rows);

        if (countRes.rows[0].CNT > 0) {
            console.log('--- SAMPLE OF PCENDERECO ROWS ---');
            const sampleRes = await conn.execute(
                `SELECT * FROM (
                    SELECT CODENDERECO, CODFILIAL, RUA, PREDIO, APTO, CODPROD, TIPOENDER, ATIVO 
                    FROM BRAGO.PCENDERECO
                ) WHERE ROWNUM <= 20`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.table(sampleRes.rows);
        }

        console.log('--- CHECK WHERE CODPROD AND CODFILIAL CORRESPOND TO PCENDERECO ---');
        // Is there another table like PCEMBALAGEM or PCESTEND or PCEST?
        // Wait, standard WinThor has PCESTEND. Let's see how many records in PCESTEND.
        // It has 391 records. Let's see a sample of PCESTEND records.
        const sampleEstend = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, RUA, MODULO, APTO, QT, QTBLOQUEADA, STATUS 
                FROM BRAGO.PCESTEND 
                WHERE QT > 0
            ) WHERE ROWNUM <= 20`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('--- PCESTEND ROWS WITH STOCK ---');
        console.table(sampleEstend.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
