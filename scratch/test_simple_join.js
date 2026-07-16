require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing the SIMPLE PCEST join query...');
        console.time('Simple Join Query Time');
        
        const query = `
            SELECT 
                M.NUMTRANSENT,
                M.CODPROD,
                M.CODFILIAL,
                E.QTBLOQUEADA,
                M.DTMOV
            FROM BRAGO.PCEST E
            JOIN BRAGO.PCMOV M ON M.CODPROD = E.CODPROD AND M.CODFILIAL = E.CODFILIAL
            LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON (
                DE.CODPROD = M.CODPROD
                AND (
                    (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                    OR
                    (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                )
            )
            WHERE E.QTBLOQUEADA > 0
              AND M.DTMOV >= TRUNC(SYSDATE) - 30
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
              AND DE.DTDESBLOQUEIO IS NULL
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Simple Join Query Time');
        console.log(`Fetched ${result.rows.length} rows.`);
        console.table(result.rows.slice(0, 10));
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
