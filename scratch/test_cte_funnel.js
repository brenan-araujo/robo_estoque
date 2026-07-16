require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing CTE-based funnel query...');
        console.time('CTE Query Time');
        
        const query = `
            WITH PENDING_GRP AS (
                SELECT 
                    CODPROD,
                    (CASE WHEN CODFILIALRETIRA IN ('20', '6') THEN '20' ELSE CODFILIALRETIRA END) AS MAPPED_FILIAL,
                    SUM(NVL(QT, 0)) AS QTPEND
                FROM BRAGO.PCPEDI
                WHERE POSICAO IN ('P', 'B')
                GROUP BY CODPROD, (CASE WHEN CODFILIALRETIRA IN ('20', '6') THEN '20' ELSE CODFILIALRETIRA END)
            ),
            STOCK_GRP AS (
                SELECT 
                    CODPROD,
                    (CASE WHEN CODFILIAL IN ('20', '6') THEN '20' ELSE CODFILIAL END) AS MAPPED_FILIAL,
                    SUM(NVL(QTESTGER,0) - NVL(QTRESERV,0) - NVL(QTINDENIZ,0) - NVL(QTBLOQUEADA,0)) AS QTDISP
                FROM BRAGO.PCEST
                GROUP BY CODPROD, (CASE WHEN CODFILIAL IN ('20', '6') THEN '20' ELSE CODFILIAL END)
            ),
            RAW_DATA AS (
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
                    NVL(I.QTPEND, 0) AS QTPEND,
                    NVL(E.QTDISP, 0) AS QTDISP
                FROM BRAGO.PCMOV M
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB ON DEB.CODPROD = M.CODPROD AND M.NUMBONUS > 0 AND DEB.NUMBONUS = M.NUMBONUS
                LEFT JOIN PENDING_GRP I ON I.CODPROD = M.CODPROD AND I.MAPPED_FILIAL = M.CODFILIAL
                LEFT JOIN STOCK_GRP E ON E.CODPROD = M.CODPROD AND E.MAPPED_FILIAL = M.CODFILIAL
                WHERE (
                    M.DTMOV >= TRUNC(SYSDATE)
                    OR 
                    (
                        M.DTMOV >= TRUNC(SYSDATE) - 30 
                        AND COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) IS NULL
                        AND (
                            I.QTPEND > 0
                            OR
                            EXISTS (
                                SELECT 1 FROM BRAGO.PCEST EST
                                WHERE EST.CODPROD = M.CODPROD
                                AND EST.QTBLOQUEADA > 0
                                AND (
                                    (M.CODFILIAL = '20' AND EST.CODFILIAL IN ('20', '6'))
                                    OR
                                    (M.CODFILIAL <> '20' AND EST.CODFILIAL = M.CODFILIAL)
                                )
                            )
                        )
                    )
                )
                AND M.CODOPER IN ('E', 'EB')
                AND M.QT > 0

                UNION ALL

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
                    DE.QTDESBLOQUEADA,
                    NVL(I.QTPEND, 0) AS QTPEND,
                    NVL(E.QTDISP, 0) AS QTDISP
                FROM BRAGO.PCLOGDESBLOQUEIO DE
                LEFT JOIN BRAGO.PCMOV M1 ON DE.CODPROD = M1.CODPROD AND DE.NUMTRANSENT = M1.NUMTRANSENT AND M1.CODOPER IN ('E', 'EB') AND M1.QT > 0 AND M1.DTMOV < TRUNC(SYSDATE)
                LEFT JOIN BRAGO.PCMOV M2 ON DE.CODPROD = M2.CODPROD AND DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M2.NUMBONUS AND M2.CODOPER IN ('E', 'EB') AND M2.QT > 0 AND M2.DTMOV < TRUNC(SYSDATE)
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = DE.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = COALESCE(M1.CODFILIAL, M2.CODFILIAL)
                LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = COALESCE(M1.CODFORNEC, M2.CODFORNEC)
                LEFT JOIN PENDING_GRP I ON I.CODPROD = DE.CODPROD AND I.MAPPED_FILIAL = COALESCE(M1.CODFILIAL, M2.CODFILIAL)
                LEFT JOIN STOCK_GRP E ON E.CODPROD = DE.CODPROD AND E.MAPPED_FILIAL = COALESCE(M1.CODFILIAL, M2.CODFILIAL)
                WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
                AND (M1.NUMTRANSENT IS NOT NULL OR M2.NUMBONUS IS NOT NULL)
            )
            SELECT 
                NUMTRANSENT,
                CODPROD,
                DESCRICAO,
                CODFILIAL,
                NOMEFILIAL,
                QT,
                NUMNOTA,
                DTMOV,
                CODOPER,
                FORNECEDOR,
                DTDESBLOQUEIO,
                QTDESBLOQUEADA,
                (CASE WHEN QTPEND > 0 THEN 'S' ELSE 'N' END) AS TEM_PENDENCIA,
                QTPEND,
                QTDISP
            FROM RAW_DATA
            ORDER BY DTDESBLOQUEIO DESC, DTMOV DESC
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.timeEnd('CTE Query Time');
        console.log(`Fetched ${result.rows.length} rows.`);
        if (result.rows.length > 0) {
            console.table(result.rows.slice(0, 5));
        }
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
