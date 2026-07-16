const oracledb = require('oracledb');
require('dotenv').config();

oracledb.initOracleClient({ libDir: 'C:\\Users\\usuario001\\Documents\\api_consulta_estoque\\oracle_client\\instantclient_23_4' });

async function checkFunnel() {
    let connection;
    try {
        connection = await oracledb.getConnection({
            user: 'COMODATO',
            password: 'C0M0D4T0',
            connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=10.2.4.2)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=BRAG6010)))'
        });
        console.log('✅ Connected to Oracle Database!\n');

        const startTime = Date.now();

        // Optimized UNION query
        const result = await connection.execute(
            `SELECT * FROM (
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
                     FROM PCPEDI I
                     WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS TEM_PENDENCIA,
                    -- Estoque disponível atual
                    (SELECT NVL(SUM(
                        NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                        - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                      ), 0)
                     FROM PCEST E
                     WHERE E.CODPROD = M.CODPROD
                     AND (
                         (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                     )
                    ) AS QTDISP
                FROM PCMOV M
                JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                LEFT JOIN PCLOGDESBLOQUEIO DE ON (
                    DE.CODPROD = M.CODPROD
                    AND (
                        (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                        OR
                        (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                    )
                )
                WHERE M.DTMOV >= TRUNC(SYSDATE)
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
                    -- Tem pendências de pedido?
                    (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                     FROM PCPEDI I
                     WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS TEM_PENDENCIA,
                    -- Estoque disponível atual
                    (SELECT NVL(SUM(
                        NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                        - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                      ), 0)
                     FROM PCEST E
                     WHERE E.CODPROD = M.CODPROD
                     AND (
                         (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                         OR
                         (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                     )
                    ) AS QTDISP
                FROM PCLOGDESBLOQUEIO DE
                JOIN PCMOV M ON (
                    DE.CODPROD = M.CODPROD
                    AND (
                        (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                        OR
                        (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                    )
                )
                JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                WHERE DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
                AND M.DTMOV < TRUNC(SYSDATE) -- Evita duplicados que já foram pegos no primeiro SELECT
                AND M.CODOPER IN ('E', 'EB')
                AND M.QT > 0
            ) ORDER BY DTDESBLOQUEIO DESC, DTMOV DESC`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`Query completed in ${Date.now() - startTime}ms`);
        console.log(`Total rows returned: ${result.rows.length}`);
        
        let unlockedCount = 0;
        let withRuleCount = 0;

        result.rows.forEach((row, i) => {
            const estAnterior = row.QTDISP - row.QT;
            const matchesRule = row.TEM_PENDENCIA === 'S' || estAnterior <= 0;
            const isUnlocked = row.DTDESBLOQUEIO !== null;

            if (isUnlocked) unlockedCount++;
            if (matchesRule) withRuleCount++;

            console.log(`Row ${i+1}: CODPROD=${row.CODPROD}, DESC=${row.DESCRICAO.substring(0, 15)}, FILIAL=${row.CODFILIAL}, DTMOV=${row.DTMOV ? row.DTMOV.toLocaleDateString('pt-BR') : '-'}, DTDESB=${row.DTDESBLOQUEIO ? row.DTDESBLOQUEIO.toLocaleString('pt-BR') : 'null'}, isUnlocked=${isUnlocked}`);
        });

        console.log(`\nSummary:`);
        console.log(`Total: ${result.rows.length}`);
        console.log(`Matches Rule: ${withRuleCount}`);
        console.log(`Unlocked: ${unlockedCount}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

checkFunnel();
