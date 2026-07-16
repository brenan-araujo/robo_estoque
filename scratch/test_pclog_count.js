require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Checking PCLOGDESBLOQUEIO statistics...');
        
        console.time('Total count');
        const r1 = await conn.execute(`SELECT COUNT(*) FROM BRAGO.PCLOGDESBLOQUEIO`);
        console.timeEnd('Total count');
        console.log(`Total rows: ${r1.rows[0][0]}`);

        console.log('\nQuerying today\'s rows (no joins)...');
        console.time('Today query');
        const r2 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCLOGDESBLOQUEIO WHERE DTDESBLOQUEIO >= TRUNC(SYSDATE)`
        );
        console.timeEnd('Today query');
        console.log(`Today rows: ${r2.rows[0][0]}`);

        console.log('\nQuerying last 30 days\' rows (no joins)...');
        console.time('Last 30 days query');
        const r3 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCLOGDESBLOQUEIO WHERE DTDESBLOQUEIO >= TRUNC(SYSDATE) - 30`
        );
        console.timeEnd('Last 30 days query');
        console.log(`Last 30 days rows: ${r3.rows[0][0]}`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
