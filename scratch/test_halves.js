require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Benchmarking Funnel Query Halves ---');

        // Part 1
        console.time('Part 1 (First query)');
        const q1 = `
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
                COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) AS DTDESBLOQUEIO,
                COALESCE(DE.QTDESBLOQUEADA, DEB.QTDESBLOQUEADA) AS QTDESBLOQUEADA,
                -- Tem pendências de pedido?
                (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                 FROM BRAGO.PCPEDI I
                 WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
                -- Quantidade de pedidos pendentes
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
                -- Estoque disponível atual
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
            LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
            LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB ON DEB.CODPROD = M.CODPROD AND M.NUMBONUS > 0 AND DEB.NUMBONUS = M.NUMBONUS
            WHERE (
                M.DTMOV >= TRUNC(SYSDATE)
                OR 
                (
                    M.DTMOV >= TRUNC(SYSDATE) - 30 
                    AND COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) IS NULL
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
        `;
        const res1 = await conn.execute(q1, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Part 1 (First query)');
        console.log(`Part 1 returned ${res1.rows.length} rows.`);

        console.log('');

        // Part 2
        console.time('Part 2 (Second query)');
        const q2 = `
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
                -- Tem pendências de pedido?
                (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                 FROM BRAGO.PCPEDI I
                 WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
                -- Quantidade de pedidos pendentes
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
                -- Estoque disponível atual
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
                    DE.NUMTRANSENT = M.NUMTRANSENT
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
        `;
        const res2 = await conn.execute(q2, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Part 2 (Second query)');
        console.log(`Part 2 returned ${res2.rows.length} rows.`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
