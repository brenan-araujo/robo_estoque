require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- BUSCANDO COLUNA OBS2 NA PCPRODUT ---');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCPRODUT' AND OWNER = 'BRAGO'
             AND COLUMN_NAME = 'OBS2'`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows);

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
