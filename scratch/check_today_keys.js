require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Checking today\'s log keys count ---');
        const q = `
            SELECT 
                COUNT(*) AS TOTAL,
                COUNT(NUMTRANSENT) AS WITH_TRANSENT,
                COUNT(NUMBONUS) AS WITH_BONUS
            FROM BRAGO.PCLOGDESBLOQUEIO
            WHERE DTDESBLOQUEIO >= TRUNC(SYSDATE)
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
