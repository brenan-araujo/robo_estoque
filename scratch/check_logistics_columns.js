require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- FINDING ADDRESS COLUMNS ---');
        // Let's search all columns containing 'RUA', 'PREDIO', 'APTO', 'APARTAMENTO', 'COORD' in PCEST, PCPRODUT, PCESTEND, PCLOCALIZ, etc.
        const cols = await conn.execute(
            `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' 
               AND TABLE_NAME IN ('PCEST', 'PCPRODUT', 'PCESTEND', 'PCLOCALIZ', 'PCENDERECO')
               AND (COLUMN_NAME LIKE '%RUA%' OR COLUMN_NAME LIKE '%PREDIO%' OR COLUMN_NAME LIKE '%APTO%' OR COLUMN_NAME LIKE '%APART%')
             ORDER BY TABLE_NAME, COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows);

        // Let's check which tables actually exist
        console.log('--- CHECKING WHICH TABLES EXIST ---');
        const existRes = await conn.execute(
            `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = 'BRAGO' AND TABLE_NAME IN ('PCEST', 'PCPRODUT', 'PCESTEND', 'PCLOCALIZ', 'PCENDERECO', 'PCENDERECODOC')`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(existRes.rows);

        // Let's describe PCEST columns matching address
        console.log('--- PCEST ADDRESS COLUMNS ---');
        const pcestCols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCEST'
               AND (COLUMN_NAME LIKE '%RUA%' OR COLUMN_NAME LIKE '%PREDIO%' OR COLUMN_NAME LIKE '%APTO%' OR COLUMN_NAME LIKE '%APART%' OR COLUMN_NAME LIKE '%LOCAL%')
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pcestCols.rows);

        // Let's check PCPRODUT columns matching address
        console.log('--- PCPRODUT ADDRESS COLUMNS ---');
        const pcprodCols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCPRODUT'
               AND (COLUMN_NAME LIKE '%RUA%' OR COLUMN_NAME LIKE '%PREDIO%' OR COLUMN_NAME LIKE '%APTO%' OR COLUMN_NAME LIKE '%APART%' OR COLUMN_NAME LIKE '%LOCAL%')
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pcprodCols.rows);

        // Standard PCEST columns sample if any
        try {
            const sampleRes = await conn.execute(
                `SELECT * FROM (
                    SELECT CODPROD, CODFILIAL, QTESTGER, QTRESERV, RUA, RUACX, APTO, APTOCX FROM BRAGO.PCEST WHERE RUA IS NOT NULL OR APTO IS NOT NULL
                ) WHERE ROWNUM <= 5`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.log('PCEST standard address columns sample:');
            console.table(sampleRes.rows);
        } catch (err) {
            console.log('PCEST select failed:', err.message);
        }

        // Standard PCPRODUT columns sample if any
        try {
            const sampleRes = await conn.execute(
                `SELECT * FROM (
                    SELECT CODPROD, RUA, PREDIO, APTO, RUACX, PREDIOCX, APTOCX FROM BRAGO.PCPRODUT WHERE RUA IS NOT NULL OR PREDIO IS NOT NULL OR APTO IS NOT NULL
                ) WHERE ROWNUM <= 5`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.log('PCPRODUT address columns sample:');
            console.table(sampleRes.rows);
        } catch (err) {
            console.log('PCPRODUT select failed:', err.message);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
