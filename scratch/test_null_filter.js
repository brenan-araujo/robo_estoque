require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Testing join on NUMTRANSENT with IS NOT NULL filter ---');
        console.time('With NUMTRANSENT null filter');
        const q1 = `
            SELECT COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMTRANSENT = M.NUMTRANSENT AND M.CODPROD = DE.CODPROD
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND DE.NUMTRANSENT IS NOT NULL
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
        `;
        const r1 = await conn.execute(q1);
        console.timeEnd('With NUMTRANSENT null filter');
        console.log(`Count 1: ${r1.rows[0][0]}`);

        console.log('\n--- Testing join on NUMBONUS with IS NOT NULL filter ---');
        console.time('With NUMBONUS null filter');
        const q2 = `
            SELECT COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMBONUS = M.NUMBONUS AND M.CODPROD = DE.CODPROD
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
        `;
        const r2 = await conn.execute(q2);
        console.timeEnd('With NUMBONUS null filter');
        console.log(`Count 2: ${r2.rows[0][0]}`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
