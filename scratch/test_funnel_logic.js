require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('../src/config/database');
const { getSentHistory } = require('../src/utils/sentTracker');

async function getFunnelProductsOtimizado(sentTodayCodes) {
    let connection;
    try {
        await database.initialize();
        connection = await database.getConnection();

        // Constrói a condição para produtos enviados hoje
        let codProdCondition = '';
        if (sentTodayCodes.size > 0) {
            const codesStr = [...sentTodayCodes].join(', ');
            codProdCondition = `OR (M.CODPROD IN (${codesStr}))`;
        }

        const query = `SELECT * FROM (
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
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB ON DEB.CODPROD = M.CODPROD AND M.NUMBONUS > 0 AND DEB.NUMBONUS = M.NUMBONUS
                WHERE M.DTMOV >= TRUNC(SYSDATE) - 30
                  AND (
                    M.DTMOV >= TRUNC(SYSDATE)
                    OR 
                    (
                        COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) IS NULL
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
                FROM BRAGO.PCMOV M
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
                LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD
                    AND (
                        DE.DTDESBLOQUEIO >= TRUNC(SYSDATE)
                        ${codProdCondition}
                    )
                    AND (
                        DE.NUMTRANSENT = M.NUMTRANSENT
                        OR
                        (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                    )
                WHERE M.DTMOV >= TRUNC(SYSDATE) - 30
                  AND M.DTMOV < TRUNC(SYSDATE)
                  AND M.CODOPER IN ('E', 'EB')
                  AND M.QT > 0
            ) ORDER BY DTDESBLOQUEIO DESC, DTMOV DESC`;

        const result = await connection.execute(query, [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
        return result.rows;
    } catch (err) {
        console.error('Error fetching funnel products:', err);
        return [];
    } finally {
        if (connection) {
            await connection.close();
        }
        await database.close();
    }
}

async function run() {
    // Carrega histórico de mensagens enviadas hoje
    const sentHistory = getSentHistory();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sentTodayCodes = new Set();
    for (const entry of sentHistory) {
        const entryDate = new Date(entry.timestamp);
        if (entryDate >= todayStart) {
            const regex = /Cód:\s*(\d+)/g;
            let match;
            while ((match = regex.exec(entry.message)) !== null) {
                sentTodayCodes.add(parseInt(match[1], 10));
            }
        }
    }
    console.log(`Produtos notificados hoje:`, [...sentTodayCodes]);

    console.log('--- TESTANDO RETORNO DA QUERY MODIFICADA ---');
    const rows = await getFunnelProductsOtimizado(sentTodayCodes);
    console.log(`Total de linhas retornadas pela query: ${rows.length}`);

    // Carrega chaves processadas
    const processedKeysPath = path.join(__dirname, '..', 'data', 'processed_keys.json');
    let processedKeys = new Set();
    if (fs.existsSync(processedKeysPath)) {
        processedKeys = new Set(JSON.parse(fs.readFileSync(processedKeysPath, 'utf8')));
    }
    console.log(`Carregadas ${processedKeys.size} chaves processadas.`);

    // Aplica a lógica de filtragem no array
    const filteredRows = rows.filter(row => {
        const key = `${row.NUMTRANSENT}-${row.CODPROD}`;
        const isUnlocked = row.DTDESBLOQUEIO !== null;
        const isUnlockedToday = isUnlocked && new Date(row.DTDESBLOQUEIO) >= todayStart;
        const isSent = processedKeys.has(key);
        const isSentToday = isSent && sentTodayCodes.has(row.CODPROD);
        
        // Verifica se chegou hoje
        const isArrivedToday = row.DTMOV ? new Date(row.DTMOV) >= todayStart : false;

        // Anexa as flags úteis para o frontend
        row.ENVIADO = isSent;
        row.ENVIADO_HOJE = isSentToday;

        if (isArrivedToday) return true;
        if (!isUnlocked) return true;
        if (isUnlockedToday) return true;
        if (isUnlocked && !isSent) return true;
        if (isSentToday) return true;

        return false;
    });

    console.log(`\nLinhas filtradas (que devem ir para o painel): ${filteredRows.length}`);
    const matchProd = filteredRows.find(r => r.CODPROD === 17321);
    if (matchProd) {
        console.log('\n✅ PRODUTO 17321 ENCONTRADO NO FUNIL FILTRADO!');
        console.log(JSON.stringify(matchProd, null, 2));
    } else {
        console.log('\n❌ PRODUTO 17321 NÃO ENCONTRADO NO FUNIL FILTRADO.');
    }
}

run();
