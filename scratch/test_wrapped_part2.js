require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing CTE-wrapped Part 2 query...');
        console.time('Wrapped Part 2 Time');
        
        const query = `
            WITH UNLOCKED_TODAY AS (
                SELECT 
                    COALESCE(M1.NUMTRANSENT, M2.NUMTRANSENT) AS NUMTRANSENT,
                    DE.CODPROD,
                    COALESCE(M1.CODFILIAL, M2.CODFILIAL) AS CODFILIAL,
                    COALESCE(M1.QT, M2.QT) AS QT,
                    COALESCE(M1.NUMNOTA, M2.NUMNOTA) AS NUMNOTA,
                    COALESCE(M1.DTMOV, M2.DTMOV) AS DTMOV,
                    COALESCE(M1.CODOPER, M2.CODOPER) AS CODOPER,
                    COALESCE(M1.CODFORNEC, M2.CODFORNEC) AS CODFORNEC,
                    DE.DTDESBLOQUEIO,
                    DE.QTDESBLOQUEADA
                FROM BRAGO.PCLOGDESBLOQUEIO DE
                LEFT JOIN BRAGO.PCMOV M1 ON DE.CODPROD = M1.CODPROD AND DE.NUMTRANSENT = M1.NUMTRANSENT AND M1.CODOPER IN ('E', 'EB') AND M1.QT > 0 AND M1.DTMOV < TRUNC(SYSDATE)
                LEFT JOIN BRAGO.PCMOV M2 ON DE.CODPROD = M2.CODPROD AND DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M2.NUMBONUS AND M2.CODOPER IN ('E', 'EB') AND M2.QT > 0 AND M2.DTMOV < TRUNC(SYSDATE)
                WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
                AND (M1.NUMTRANSENT IS NOT NULL OR M2.NUMBONUS IS NOT NULL)
            )
            SELECT 
                U.NUMTRANSENT,
                U.CODPROD,
                P.DESCRICAO,
                U.CODFILIAL,
                F.RAZAOSOCIAL AS NOMEFILIAL,
                U.QT,
                U.NUMNOTA,
                U.DTMOV,
                U.CODOPER,
                FORN.FANTASIA AS FORNECEDOR,
                U.DTDESBLOQUEIO,
                U.QTDESBLOQUEADA,
                -- Tem pendências de pedido?
                (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                 FROM BRAGO.PCPEDI I
                 WHERE I.CODPROD = U.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (U.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (U.CODFILIAL <> '20' AND I.CODFILIALRETIRA = U.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
                -- Quantidade de pedidos pendentes
                (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                 FROM BRAGO.PCPEDI I
                 WHERE I.CODPROD = U.CODPROD
                 AND I.POSICAO IN ('P', 'B')
                 AND (
                     (U.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (U.CODFILIAL <> '20' AND I.CODFILIALRETIRA = U.CODFILIAL)
                 )
                ) AS QTPEND,
                -- Estoque disponível atual
                (SELECT NVL(SUM(
                    NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                    - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                  ), 0)
                 FROM BRAGO.PCEST E
                 WHERE E.CODPROD = U.CODPROD
                 AND (
                     (U.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                     OR
                     (U.CODFILIAL <> '20' AND E.CODFILIAL = U.CODFILIAL)
                 )
                ) AS QTDISP
            FROM UNLOCKED_TODAY U
            JOIN BRAGO.PCPRODUT P ON P.CODPROD = U.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
            LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = U.CODFILIAL
            LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = U.CODFORNEC
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Wrapped Part 2 Time');
        console.log(`Returned ${result.rows.length} rows.`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
