require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- FINDING LOGISTICS/ADDRESS TABLES ---');
        const tables = await conn.execute(
            `SELECT TABLE_NAME FROM ALL_TABLES 
             WHERE OWNER = 'BRAGO' 
               AND (TABLE_NAME LIKE '%END%' OR TABLE_NAME LIKE '%LOC%' OR TABLE_NAME LIKE '%WMS%' OR TABLE_NAME LIKE '%DEP%')
             ORDER BY TABLE_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(tables.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
