require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- PCPRODUT ADDRESS COLS SAMPLE ---');
        const resProd = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, RUA, PREDIO, APTO 
                FROM BRAGO.PCPRODUT 
                WHERE RUA IS NOT NULL OR PREDIO IS NOT NULL OR APTO IS NOT NULL
            ) WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(resProd.rows);

        console.log('--- PCEST ADDRESS COLS SAMPLE ---');
        const resEst = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, CODFILIAL, RUA, APTO, RUACX, APTOCX 
                FROM BRAGO.PCEST 
                WHERE RUA IS NOT NULL OR APTO IS NOT NULL
            ) WHERE ROWNUM <= 10`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(resEst.rows);

        console.log('--- CHECK WHERE RUA/PREDIO/APTO ARE DEFINED IN WinThor ---');
        // Let's check if there are columns like RUA, PREDIO, APTO in PCITEM or PCPEDIDO
        const checkItemCols = await conn.execute(
            `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCITEM' AND COLUMN_NAME IN ('RUA', 'PREDIO', 'APTO')`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Address columns in PCITEM:', checkItemCols.rows);

        // Let's count how many distinct products have addresses in PCPRODUT
        const countProd = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM BRAGO.PCPRODUT WHERE RUA IS NOT NULL OR PREDIO IS NOT NULL OR APTO IS NOT NULL`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Products with addresses in PCPRODUT:', countProd.rows[0].CNT);

        // Let's check how many products in PCEST have non-zero or null address
        const countPcestAddress = await conn.execute(
            `SELECT COUNT(DISTINCT CODPROD) AS CNT FROM BRAGO.PCEST WHERE RUA IS NOT NULL OR APTO IS NOT NULL`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Distinct products with addresses in PCEST:', countPcestAddress.rows[0].CNT);

        // Check PCEST addresses for a few specific active products in purchasing report
        // For example, product 12603 or others.
        console.log('--- ADDRESS OF CODPROD 12603 IN PCEST ---');
        const res12603 = await conn.execute(
            `SELECT CODPROD, CODFILIAL, RUA, APTO FROM BRAGO.PCEST WHERE CODPROD = 12603`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(res12603.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
