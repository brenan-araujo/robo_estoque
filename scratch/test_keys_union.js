require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Testing join ONLY on NUMTRANSENT ---');
        
        console.time('Join on NUMTRANSENT only');
        const q1 = `
            SELECT COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMTRANSENT = M.NUMTRANSENT AND M.CODPROD = DE.CODPROD
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
        `;
        const r1 = await conn.execute(q1);
        console.timeEnd('Join on NUMTRANSENT only');
        console.log(`Count 1: ${r1.rows[0][0]}`);

        console.log('\n--- Testing join ONLY on NUMTRANSENT (without CODPROD join) ---');
        console.time('Join on NUMTRANSENT only without CODPROD');
        const q2 = `
            SELECT COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMTRANSENT = M.NUMTRANSENT
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
              AND M.CODPROD = DE.CODPROD
        `;
        const r2 = await conn.execute(q2);
        console.timeEnd('Join on NUMTRANSENT only without CODPROD');
        console.log(`Count 2: ${r2.rows[0][0]}`);

        console.log('\n--- Testing join on NUMTRANSENT with Oracle INDEX Hint ---');
        console.time('Join with index hint');
        const q3 = `
            SELECT /*+ INDEX(M PCMOV_IDX7) */ COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMTRANSENT = M.NUMTRANSENT AND M.CODPROD = DE.CODPROD
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
        `;
        const r3 = await conn.execute(q3);
        console.timeEnd('Join with index hint');
        console.log(`Count 3: ${r3.rows[0][0]}`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
