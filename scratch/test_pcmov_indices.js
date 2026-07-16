require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing PCMOV lookup by NUMTRANSENT...');
        console.time('Lookup by NUMTRANSENT');
        const r1 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCMOV WHERE NUMTRANSENT = 373436`
        );
        console.timeEnd('Lookup by NUMTRANSENT');
        console.log(`Rows: ${r1.rows[0][0]}`);

        console.log('\nTesting PCMOV lookup by NUMBONUS...');
        console.time('Lookup by NUMBONUS');
        const r2 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCMOV WHERE NUMBONUS = 58002`
        );
        console.timeEnd('Lookup by NUMBONUS');
        console.log(`Rows: ${r2.rows[0][0]}`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
