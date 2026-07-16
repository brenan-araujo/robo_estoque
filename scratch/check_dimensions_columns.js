require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- FINDING DIMENSION/WEIGHT COLUMNS ---');
        // Let's search columns containing ALT, LAR, COMP, VOL, PES, DIM in PCPRODUT
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' 
               AND TABLE_NAME = 'PCPRODUT'
               AND (
                 COLUMN_NAME LIKE '%ALT%' OR 
                 COLUMN_NAME LIKE '%LAR%' OR 
                 COLUMN_NAME LIKE '%COMP%' OR 
                 COLUMN_NAME LIKE '%VOL%' OR 
                 COLUMN_NAME LIKE '%PES%'
               )
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows);

        // Let's check counts of populated values for potential dimension columns
        // Standard WinThor names: ALTURACX, LARGURACX, COMPRIMENTOCX, VOLUMECX, PESOBRUTO, PESOLIQUIDO, ALTURA, LARGURA, COMPRIMENTO, VOLUME
        const counts = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL,
                COUNT(ALTURACX) AS CONTA_ALTURACX,
                COUNT(LARGURACX) AS CONTA_LARGURACX,
                COUNT(COMPRIMENTOCX) AS CONTA_COMPRIMENTOCX,
                COUNT(VOLUMECX) AS CONTA_VOLUMECX,
                COUNT(PESOBRUTO) AS CONTA_PESOBRUTO,
                COUNT(PESOLIQUIDO) AS CONTA_PESOLIQUIDO,
                COUNT(VOLUME) AS CONTA_VOLUME
             FROM BRAGO.PCPRODUT`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Counts of dimension values in PCPRODUT:');
        console.table(counts.rows);

        // Let's sample some populated dimension records
        const sample = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, ALTURACX, LARGURACX, COMPRIMENTOCX, VOLUMECX, PESOBRUTO, VOLUME
                FROM BRAGO.PCPRODUT 
                WHERE ALTURACX > 0 OR VOLUMECX > 0 OR VOLUME > 0
            ) WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Sample of product dimensions:');
        console.table(sample.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
