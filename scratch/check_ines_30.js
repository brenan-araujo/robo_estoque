require('dotenv').config({ path: 'c:/Users/usuario001/Documents/api_consulta_estoque/.env' });
const db = require('../src/config/database.js');
const { oracledb } = db;

async function run() {
    await db.initialize();
    const conn = await db.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    console.log('Querying columns in ALL_TAB_COLUMNS for PCNFSAID:');
    try {
        const cols = await conn.execute(`
            SELECT COLUMN_NAME
            FROM ALL_TAB_COLUMNS
            WHERE TABLE_NAME = 'PCNFSAID'
              AND (COLUMN_NAME LIKE '%VL%' OR COLUMN_NAME LIKE '%VAL%' OR COLUMN_NAME LIKE '%TOT%')
            ORDER BY COLUMN_NAME
        `, [], opt);
        console.log('Columns matching in PCNFSAID:', cols.rows.map(r => r.COLUMN_NAME));
    } catch (e) {
        console.error('Error querying columns:', e.message);
    }

    await conn.close();
    await db.close();
}

run().catch(console.error);
