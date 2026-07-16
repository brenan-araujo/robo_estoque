require('dotenv').config();
const database = require('../src/config/database');
const { getConnection, oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- CHECK UNADDRESSED PRODUCTS IN PCEST ---');
        // Let's query PCEST for filial 20 and 6, and check the values of RUA and APTO
        const result = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, CODFILIAL, RUA, APTO, QTESTGER
                FROM BRAGO.PCEST
                WHERE CODFILIAL IN ('20', '6')
                  AND (RUA IN ('99', '0', '00') OR APTO IN ('99', '0', '00') OR RUA IS NULL OR APTO IS NULL)
                  AND QTESTGER > 0
            ) WHERE ROWNUM <= 20`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(result.rows);

        const counts = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL_ACTIVE,
                COUNT(CASE WHEN RUA IN ('99', '0', '00') OR APTO IN ('99', '0', '00') OR RUA IS NULL OR APTO IS NULL THEN 1 END) AS UNADDRESSED
             FROM BRAGO.PCEST
             WHERE CODFILIAL IN ('20', '6')
               AND QTESTGER > 0`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Counts:');
        console.table(counts.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
