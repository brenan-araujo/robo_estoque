require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- BUSCANDO TABELA EXATA PCPEDC ---');
        const res = await conn.execute(
            `SELECT OWNER, TABLE_NAME 
             FROM ALL_TABLES 
             WHERE TABLE_NAME = 'PCPEDC'
             ORDER BY TABLE_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(res.rows);

        if (res.rows.length > 0) {
            console.log('--- COLUNAS DE PCPEDC ---');
            const cols = await conn.execute(
                `SELECT COLUMN_NAME, DATA_TYPE 
                 FROM ALL_TAB_COLUMNS 
                 WHERE TABLE_NAME = 'PCPEDC' AND OWNER = 'BRAGO'
                 ORDER BY COLUMN_ID`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.table(cols.rows.slice(0, 30));
        }

        console.log('--- BUSCANDO TODAS AS COLUNAS DE PCITEM ---');
        const cols2 = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCITEM' AND OWNER = 'BRAGO'
             ORDER BY COLUMN_ID`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols2.rows);

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
