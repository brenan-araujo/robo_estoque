require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- CHECKING NUMERO AND MASTER PACK FIELDS IN PCPRODUT ---');
        // Let's check columns in PCPRODUT that might contain 'NUM' or 'CX' or 'UNIT'
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' 
               AND TABLE_NAME = 'PCPRODUT'
               AND (COLUMN_NAME LIKE '%NUMERO%' OR COLUMN_NAME LIKE '%CX%' OR COLUMN_NAME LIKE '%UNIT%' OR COLUMN_NAME LIKE '%EMB%')
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows);

        // Let's check counts of populated values for NUMERO, QTUNITCX, etc.
        const counts = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL,
                COUNT(NUMERO) AS CONTA_NUMERO,
                COUNT(QTUNITCX) AS CONTA_QTUNITCX,
                COUNT(EMBALAGEM) AS CONTA_EMB
             FROM BRAGO.PCPRODUT`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Counts of values in PCPRODUT:');
        console.table(counts.rows);

        // Let's print a sample of values for NUMERO, QTUNITCX, EMBALAGEM, DESCRICAO
        const sample = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, NUMERO, QTUNITCX, EMBALAGEM 
                FROM BRAGO.PCPRODUT 
                WHERE NUMERO IS NOT NULL OR QTUNITCX > 0
            ) WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Sample of populated values:');
        console.table(sample.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
