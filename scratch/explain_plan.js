require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Generating Explain Plan ---');
        
        const q = `
            EXPLAIN PLAN FOR
            SELECT /*+ MONITOR */ COUNT(*) 
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.NUMTRANSENT = M.NUMTRANSENT AND M.CODPROD = DE.CODPROD
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
              AND DE.NUMTRANSENT IS NOT NULL
              AND M.DTMOV >= TRUNC(SYSDATE) - 45
              AND M.DTMOV < TRUNC(SYSDATE)
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
        `;
        await conn.execute(q);
        
        const plan = await conn.execute(`SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY)`);
        for (const row of plan.rows) {
            console.log(row[0]);
        }

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
