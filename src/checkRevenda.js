require('dotenv').config();
const database = require('./config/database');
const { oracledb } = require('./config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();

    const cols = await conn.execute(
        `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = 'PCFORNEC' AND (COLUMN_NAME LIKE '%FANTASIA%' OR COLUMN_NAME LIKE '%FORNECEDOR%' OR COLUMN_NAME LIKE '%NOME%' OR COLUMN_NAME LIKE '%RAZAO%')`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log(cols.rows);

    await conn.close();
    await database.close();
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
