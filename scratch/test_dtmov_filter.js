require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Testing join on NUMTRANSENT with DTMOV >= SYSDATE - 45 ---');
        console.time('With DTMOV limit');
        const q1 = `
            SELECT COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMTRANSENT = M.NUMTRANSENT AND M.CODPROD = DE.CODPROD
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND DE.NUMTRANSENT IS NOT NULL
              AND M.DTMOV >= TRUNC(SYSDATE) - 45
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
        `;
        const r1 = await conn.execute(q1);
        console.timeEnd('With DTMOV limit');
        console.log(`Count 1: ${r1.rows[0][0]}`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
