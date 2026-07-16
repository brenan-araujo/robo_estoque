require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing the OPTIMIZED join query (NUMTRANSENT only)...');
        console.time('NUMTRANSENT Join Time');
        
        const query = `
            SELECT 
                M.NUMTRANSENT,
                M.CODPROD,
                M.CODFILIAL,
                E.QTBLOQUEADA,
                M.DTMOV
            FROM BRAGO.PCEST E
            JOIN BRAGO.PCMOV M ON M.CODPROD = E.CODPROD AND M.CODFILIAL = E.CODFILIAL
            LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
            WHERE E.QTBLOQUEADA > 0
              AND M.DTMOV >= TRUNC(SYSDATE) - 30
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
              AND DE.DTDESBLOQUEIO IS NULL
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('NUMTRANSENT Join Time');
        console.log(`Fetched ${result.rows.length} rows.`);
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
