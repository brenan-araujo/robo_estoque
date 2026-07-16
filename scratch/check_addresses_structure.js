require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- ALL COLUMNS OF PCENDERECO ---');
        const pcendCols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCENDERECO'
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pcendCols.rows.map(r => r.COLUMN_NAME));

        console.log('--- ALL COLUMNS OF PCESTEND ---');
        const pcestendCols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCESTEND'
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pcestendCols.rows.map(r => r.COLUMN_NAME));

        console.log('--- PCESTEND SAMPLE ---');
        try {
            const samplePcestend = await conn.execute(
                `SELECT * FROM (
                    SELECT CODPROD, CODFILIAL, RUA, PREDIO, APTO, QTEST, QTBLOQUEADA 
                    FROM BRAGO.PCESTEND
                ) WHERE ROWNUM <= 5`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.table(samplePcestend.rows);
        } catch (err) {
            console.log('PCESTEND select failed:', err.message);
        }

        console.log('--- PCENDERECO SAMPLE ---');
        try {
            // Check if there is CODPROD in PCENDERECO
            const samplePcend = await conn.execute(
                `SELECT * FROM (
                    SELECT RUA, PREDIO, APTO, CODFILIAL, STATUS, TIPOENDERECO 
                    FROM BRAGO.PCENDERECO
                ) WHERE ROWNUM <= 5`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.table(samplePcend.rows);
        } catch (err) {
            console.log('PCENDERECO select failed:', err.message);
        }

        console.log('--- CHECK WHERE RUA/PREDIO/APARTAMENTO ARE SET BY PRODUCT/FILIAL ---');
        // Let's count how many products have non-null address in PCPRODUT
        const countProd = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM BRAGO.PCPRODUT WHERE RUA IS NOT NULL OR PREDIO IS NOT NULL OR APTO IS NOT NULL`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Products with addresses in PCPRODUT:', countProd.rows[0].CNT);

        // Let's count how many products have non-null address in PCEST
        const countEst = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM BRAGO.PCEST WHERE RUA IS NOT NULL OR APTO IS NOT NULL`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Products with addresses in PCEST:', countEst.rows[0].CNT);

        // Let's see if PCEST has a PREDIO/APTO/RUA stored in another way or if there's PCESTEND records
        const countEstend = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM BRAGO.PCESTEND`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Records in PCESTEND:', countEstend.rows[0].CNT);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
