require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Checking PCMOV columns ---');
        const r1 = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, DATA_PRECISION, DATA_SCALE, CHAR_LENGTH 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCMOV' AND COLUMN_NAME IN ('NUMTRANSENT', 'NUMBONUS')`
        );
        console.table(r1.rows);

        console.log('\n--- Checking PCLOGDESBLOQUEIO columns ---');
        const r2 = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, DATA_PRECISION, DATA_SCALE, CHAR_LENGTH 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCLOGDESBLOQUEIO' AND COLUMN_NAME IN ('NUMTRANSENT', 'NUMBONUS')`
        );
        console.table(r2.rows);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
