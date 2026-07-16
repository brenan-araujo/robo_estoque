require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing Part 2 WITHOUT subqueries in SELECT...');
        console.time('No Subqueries Time');
        
        const query = `
            SELECT 
                COALESCE(M1.NUMTRANSENT, M2.NUMTRANSENT) AS NUMTRANSENT,
                DE.CODPROD,
                P.DESCRICAO,
                COALESCE(M1.CODFILIAL, M2.CODFILIAL) AS CODFILIAL,
                F.RAZAOSOCIAL AS NOMEFILIAL,
                COALESCE(M1.QT, M2.QT) AS QT,
                COALESCE(M1.NUMNOTA, M2.NUMNOTA) AS NUMNOTA,
                COALESCE(M1.DTMOV, M2.DTMOV) AS DTMOV,
                COALESCE(M1.CODOPER, M2.CODOPER) AS CODOPER,
                FORN.FANTASIA AS FORNECEDOR,
                DE.DTDESBLOQUEIO,
                DE.QTDESBLOQUEADA
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            LEFT JOIN BRAGO.PCMOV M1 ON DE.CODPROD = M1.CODPROD AND DE.NUMTRANSENT = M1.NUMTRANSENT AND M1.CODOPER IN ('E', 'EB') AND M1.QT > 0 AND M1.DTMOV < TRUNC(SYSDATE)
            LEFT JOIN BRAGO.PCMOV M2 ON DE.CODPROD = M2.CODPROD AND DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M2.NUMBONUS AND M2.CODOPER IN ('E', 'EB') AND M2.QT > 0 AND M2.DTMOV < TRUNC(SYSDATE)
            JOIN BRAGO.PCPRODUT P ON P.CODPROD = DE.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
            LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = COALESCE(M1.CODFILIAL, M2.CODFILIAL)
            LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = COALESCE(M1.CODFORNEC, M2.CODFORNEC)
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
            AND (M1.NUMTRANSENT IS NOT NULL OR M2.NUMBONUS IS NOT NULL)
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('No Subqueries Time');
        console.log(`Returned ${result.rows.length} rows.`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
