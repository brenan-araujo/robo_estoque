require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Listing PCMOV indexes ---');
        const q = `
            SELECT i.index_name, ic.column_name, ic.column_position
            FROM all_indexes i
            JOIN all_ind_columns ic ON i.index_name = ic.index_name AND i.owner = ic.index_owner
            WHERE i.table_owner = 'BRAGO' AND i.table_name = 'PCMOV'
              AND ic.column_name IN ('NUMTRANSENT', 'NUMBONUS', 'CODPROD')
            ORDER BY i.index_name, ic.column_position
        `;
        const res = await conn.execute(q);
        console.table(res.rows);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
