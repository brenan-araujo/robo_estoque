require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing the DOUBLE JOIN query (index friendly)...');
        console.time('Double Join Time');
        
        const query = `
            SELECT 
                M.NUMTRANSENT,
                M.CODPROD,
                M.CODFILIAL,
                E.QTBLOQUEADA,
                M.DTMOV,
                COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) AS DTDESBLOQUEIO
            FROM BRAGO.PCEST E
            JOIN BRAGO.PCMOV M ON M.CODPROD = E.CODPROD AND M.CODFILIAL = E.CODFILIAL
            LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
            LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB ON DEB.CODPROD = M.CODPROD AND M.NUMBONUS > 0 AND DEB.NUMBONUS = M.NUMBONUS
            WHERE E.QTBLOQUEADA > 0
              AND M.DTMOV >= TRUNC(SYSDATE) - 30
              AND M.CODOPER IN ('E', 'EB')
              AND M.QT > 0
              AND COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) IS NULL
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Double Join Time');
        console.log(`Fetched ${result.rows.length} rows.`);
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
