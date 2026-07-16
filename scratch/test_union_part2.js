require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing Part 2 using UNION split...');
        console.time('Union Split Time');
        
        const query = `
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
                 WHERE I.CODPROD = DE.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
                -- Quantidade de pedidos pendentes
                (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                 FROM BRAGO.PCPEDI I
                 WHERE I.CODPROD = DE.CODPROD
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
                 WHERE E.CODPROD = DE.CODPROD
                 AND (
                     (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                 )
                ) AS QTDISP
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
            JOIN BRAGO.PCPRODUT P ON P.CODPROD = DE.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
            LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
            LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
            AND M.DTMOV < TRUNC(SYSDATE)
            AND M.CODOPER IN ('E', 'EB')
            AND M.QT > 0

            UNION

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
                 WHERE I.CODPROD = DE.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
                -- Quantidade de pedidos pendentes
                (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                 FROM BRAGO.PCPEDI I
                 WHERE I.CODPROD = DE.CODPROD
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
                 WHERE E.CODPROD = DE.CODPROD
                 AND (
                     (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                 )
                ) AS QTDISP
            FROM BRAGO.PCLOGDESBLOQUEIO DE
            JOIN BRAGO.PCMOV M ON DE.CODPROD = M.CODPROD AND DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS
            JOIN BRAGO.PCPRODUT P ON P.CODPROD = DE.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
            LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
            LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
            WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
            AND M.DTMOV < TRUNC(SYSDATE)
            AND M.CODOPER IN ('E', 'EB')
            AND M.QT > 0
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('Union Split Time');
        console.log(`Returned ${result.rows.length} rows.`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
