require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- DATE COLUMNS OF PCPEDC ---');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCPEDC' AND OWNER = 'BRAGO'
             AND DATA_TYPE = 'DATE'
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
