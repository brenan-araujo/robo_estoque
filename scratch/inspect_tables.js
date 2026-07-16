require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- TABLES IN BRAGO ---');
        const tables = await conn.execute(
            `SELECT TABLE_NAME FROM ALL_TABLES 
             WHERE TABLE_NAME IN ('PCPEDIDO', 'PCITEM', 'PCPEDC') AND OWNER = 'BRAGO'`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(tables.rows);

        for (const tbl of ['PCPEDIDO', 'PCPEDC', 'PCITEM']) {
            console.log(`\n--- COLUMNS OF ${tbl} ---`);
            const cols = await conn.execute(
                `SELECT COLUMN_NAME, DATA_TYPE 
                 FROM ALL_TAB_COLUMNS 
                 WHERE TABLE_NAME = :tbl AND OWNER = 'BRAGO'
                 AND COLUMN_NAME IN ('DTCANCEL', 'POSICAO', 'SITUACAO', 'DTEMISSAO', 'NUMPED', 'CODFILIAL', 'CODPROD', 'QTPEDIDA', 'QTENTREGUE')
                 ORDER BY COLUMN_NAME`,
                { tbl }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.table(cols.rows);
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
