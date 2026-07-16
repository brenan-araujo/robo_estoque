require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- STATUS/CANCEL COLUMNS OF PCPEDIDO ---');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCPEDIDO'
               AND (COLUMN_NAME LIKE '%CANCEL%' OR COLUMN_NAME LIKE '%STATUS%' OR COLUMN_NAME LIKE '%SITUA%' OR COLUMN_NAME LIKE '%POS%')
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
