require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing OPTIMIZED funnel query...');
        console.time('Optimized Query Time');
        const query = `
            SELECT * FROM (
                SELECT 
                    M.NUMTRANSENT,
                    M.CODPROD,
                    P.DESCRICAO,
                    M.CODFILIAL,
                    F.RAZAOSOCIAL AS NOMEFILIAL,
                    M.QT,
                    M.NUMNOTA,
                    M.DTMOV,
                    M.CODOPER,
                    FORN.FANTASIA AS FORNECEDOR,
                    DE.DTDESBLOQUEIO,
                    DE.QTDESBLOQUEADA,
                    (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS TEM_PENDENCIA,
                    (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD
                     AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS QTPEND,
                    (SELECT NVL(SUM(
                        NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                        - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                       ), 0)
                     FROM BRAGO.PCEST E
                     WHERE E.CODPROD = M.CODPROD
                     AND (
                         (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                     )
                    ) AS QTDISP
                FROM BRAGO.PCMOV M
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON (
                    DE.CODPROD = M.CODPROD
                    AND (
                        (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                        OR
                        (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                    )
                )
                WHERE (
                    M.DTMOV >= TRUNC(SYSDATE)
                    OR 
                    (
                        M.DTMOV >= TRUNC(SYSDATE) - 30 
                        AND DE.DTDESBLOQUEIO IS NULL
                        AND (
                            EXISTS (
                                SELECT 1 FROM BRAGO.PCPEDI I 
                                WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                                AND (
                                    (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                                    OR
                                    (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                                )
                            )
                            OR
                            EXISTS (
                                SELECT 1 FROM BRAGO.PCEST E
                                WHERE E.CODPROD = M.CODPROD
                                AND E.QTBLOQUEADA > 0
                                AND (
                                    (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                                    OR
                                    (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                                )
                            )
                        )
                    )
                )
                AND M.CODOPER IN ('E', 'EB')
                AND M.QT > 0
                
                UNION ALL
                
                SELECT 
                    M.NUMTRANSENT,
                    M.CODPROD,
                    P.DESCRICAO,
                    M.CODFILIAL,
                    F.RAZAOSOCIAL AS NOMEFILIAL,
                    M.QT,
                    M.NUMNOTA,
                    M.DTMOV,
                    M.CODOPER,
                    FORN.FANTASIA AS FORNECEDOR,
                    DE.DTDESBLOQUEIO,
                    DE.QTDESBLOQUEADA,
                    (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS TEM_PENDENCIA,
                    (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD
                     AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS QTPEND,
                    (SELECT NVL(SUM(
                        NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                        - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                       ), 0)
                     FROM BRAGO.PCEST E
                     WHERE E.CODPROD = M.CODPROD
                     AND (
                         (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                     )
                    ) AS QTDISP
                FROM BRAGO.PCLOGDESBLOQUEIO DE
                JOIN BRAGO.PCMOV M ON (
                    DE.CODPROD = M.CODPROD
                    AND (
                        (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                        OR
                        (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                    )
                )
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
                AND M.DTMOV < TRUNC(SYSDATE)
                AND M.CODOPER IN ('E', 'EB')
                AND M.QT > 0
            ) ORDER BY DTDESBLOQUEIO DESC, DTMOV DESC
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Optimized Query Time');
        console.log(`Fetched ${result.rows.length} rows.`);
        if (result.rows.length > 0) {
            console.table(result.rows.slice(0, 5));
        }
        
        await conn.close();
    } catch (err) {
        console.error('Error executing query:', err);
    } finally {
        await database.close();
    }
}

run();
