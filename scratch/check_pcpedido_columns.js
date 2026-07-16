require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- ALL COLUMNS OF PCPEDIDO ---');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCPEDIDO'
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows.map(r => r.COLUMN_NAME));
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
