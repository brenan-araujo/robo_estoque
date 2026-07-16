const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');


/**
 * Busca novas entradas de mercadoria na PCMOV
 * que tenham NUMTRANSENT maior que o último processado
 * 
 * @param {number} lastNumTransEnt - Último NUMTRANSENT processado
 * @returns {Array} Lista de entradas agrupáveis por filial
 */
async function getNewEntries(lastUnlockDate) {
    let connection;
    try {
        connection = await getConnection();

        // Garante que lastUnlockDate seja um objeto Date
        const lastUnlockDateObj = lastUnlockDate instanceof Date ? lastUnlockDate : new Date(lastUnlockDate);

        const result = await connection.execute(
            `SELECT 
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
                (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                 FROM PCPEDI I
                 WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
                (SELECT NVL(SUM(
                    NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                    - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                 ), 0)
                 FROM PCEST E
                 WHERE E.CODPROD = M.CODPROD
                 AND (
                     (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                     OR
                     (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                 )
                ) AS QTDISP,
                (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                 FROM PCPEDI I
                 WHERE I.CODPROD = M.CODPROD
                 AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS QTPEND
             FROM PCMOV M
             JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO NOT IN (6, 103)
             LEFT JOIN PCFILIAL F ON F.CODIGO = M.CODFILIAL
             LEFT JOIN PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
             INNER JOIN PCLOGDESBLOQUEIO DE ON (
                 DE.CODPROD = M.CODPROD
                 AND (
                     (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                     OR
                     (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
                 )
             )
             LEFT JOIN PCLOGDESBLOQUEIO DE2 ON (
                 DE2.CODPROD = M.CODPROD
                 AND DE2.CODFILIAL = M.CODFILIAL
                 AND DE2.QTDESBLOQUEADA > 0
                 AND DE2.DTDESBLOQUEIO BETWEEN DE.DTDESBLOQUEIO - NUMTODSINTERVAL(5, 'MINUTE') AND DE.DTDESBLOQUEIO + NUMTODSINTERVAL(5, 'MINUTE')
             )
             WHERE DE.DTDESBLOQUEIO >= :lastUnlockDate
             AND M.CODFORNEC NOT IN (3, 4, 14566, 14631, 14574, 14573)
             AND M.CODOPER IN ('E', 'EB', 'EP')
             AND M.QT > 0
             AND (
                 -- O estoque atual livre DEVE ser maior que zero (Pronto para venda!)
                 (SELECT NVL(SUM(
                     NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                     - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                  ), 0)
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                  AND (
                      (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                  )
                 ) > 0
             )
             AND (
                 -- Regra A: O estoque antes de desbloquear era zerado ou negativo (Desconta a quantidade desbloqueada da PCLOGDESBLOQUEIO)
                 (SELECT NVL(SUM(
                     NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                     - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                  ), 0) - COALESCE(DE.QTDESBLOQUEADA, DE2.QTDESBLOQUEADA, 0)
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                  AND (
                      (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                  )
                 ) <= 0
                 OR
                 -- Regra B: Há mais pedidos pendentes do que estoque disponível
                 (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                  FROM PCPEDI I
                  WHERE I.CODPROD = M.CODPROD
                  AND I.POSICAO IN ('P', 'B')
                  AND (
                      (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                      OR
                      (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
                  )
                 ) > 
                 (SELECT NVL(SUM(
                     NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                     - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                  ), 0)
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                  AND (
                      (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                  )
                 )
             )
             ORDER BY M.CODFILIAL, DE.DTDESBLOQUEIO, M.NUMTRANSENT`,
            { lastUnlockDate: lastUnlockDateObj },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const mappedRows = result.rows.map(row => {
            if (String(row.CODFILIAL) === '6') {
                return {
                    ...row,
                    CODFILIAL: '20',
                    NOMEFILIAL: 'BRAGO BRASILIA'
                };
            }
            return row;
        });

        logger.debug(`Query retornou ${mappedRows.length} novas entradas desbloqueadas (DTDESBLOQUEIO >= ${lastUnlockDateObj.toISOString()})`);
        return mappedRows;

    } catch (err) {
        logger.error(`Erro ao buscar entradas: ${err.message}`);
        return [];
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Agrupa as entradas por filial para envio de mensagens consolidadas
 * 
 * @param {Array} entries - Lista de entradas da PCMOV
 * @returns {Object} Mapa { codFilial: { nomeFilial, items: [...] } }
 */
function groupByFilial(entries) {
    const groups = {};

    for (const entry of entries) {
        const filial = String(entry.CODFILIAL);
        if (!groups[filial]) {
            groups[filial] = {
                nomeFilial: entry.NOMEFILIAL || `Filial ${filial}`,
                items: [],
            };
        }
        groups[filial].items.push({
            codProd: entry.CODPROD,
            descricao: entry.DESCRICAO,
            quantidade: entry.QT,
            numNota: entry.NUMNOTA,
            dtMov: entry.DTMOV,
            numTransEnt: entry.NUMTRANSENT,
            fornecedor: entry.FORNECEDOR,
            temPendencia: entry.TEM_PENDENCIA === 'S',
            qtDisp: entry.QTDISP,
            qtPend: entry.QTPEND,
        });
    }

    return groups;
}

/**
 * Formata a mensagem de notificação para uma filial
 * 
 * @param {string} codFilial - Código da filial
 * @param {Object} data - Dados agrupados { nomeFilial, items }
 * @returns {string} Mensagem formatada para WhatsApp
 */
function formatMessage(codFilial, data) {
    const now = new Date();
    const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    let msg = `📦 *Entrada de Mercadoria*\n`;
    msg += `🏢 *${data.nomeFilial}* (Filial ${codFilial})\n\n`;

    // Agrupa por fornecedor
    const porFornecedor = {};
    for (const item of data.items) {
        const forn = item.fornecedor || 'NÃO IDENTIFICADO';
        if (!porFornecedor[forn]) porFornecedor[forn] = [];
        porFornecedor[forn].push(item);
    }

    for (const [forn, items] of Object.entries(porFornecedor)) {
        msg += `FORNECEDOR: *${forn}*\n\n`;
        
        // Consolidar itens por codProd para evitar duplicações do mesmo produto
        const consolidatedItems = [];
        const itemMap = new Map();
        for (const item of items) {
            if (itemMap.has(item.codProd)) {
                const existing = itemMap.get(item.codProd);
                existing.quantidade += item.quantidade;
            } else {
                const cloned = { ...item };
                itemMap.set(item.codProd, cloned);
                consolidatedItems.push(cloned);
            }
        }

        const pendentes = consolidatedItems.filter(i => i.temPendencia);
        const normais = consolidatedItems.filter(i => !i.temPendencia);

        if (pendentes.length > 0) {
            msg += `🚨 *ITENS COM PEDIDOS PENDENTES:*\n`;
            for (const item of pendentes) {
                msg += `✅ Cód: ${item.codProd} - ${item.descricao} | Qtd: *${item.quantidade}*\n\n`;
            }
        }

        if (normais.length > 0) {
            if (pendentes.length > 0) {
                msg += `📦 *OUTROS ITENS:*\n`;
            }
            for (const item of normais) {
                msg += `✅ Cód: ${item.codProd} - ${item.descricao} | Qtd: *${item.quantidade}*\n\n`;
            }
        }
    }

    msg += `──────────────────\n`;
    msg += `🕐 ${dataHora}`;

    return msg;
}

/**
 * Busca todas as entradas do dia de hoje e calcula o status do funil para cada item
 */
async function getFunnelProducts() {
    let connection;
    try {
        // Carrega histórico de mensagens enviadas hoje
        let sentTodayCodes = new Set();
        let sentTimestamps = new Map(); // Maps product code -> ISO String timestamp
        try {
            const { getSentHistory } = require('../utils/sentTracker');
            const sentHistory = getSentHistory();
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            for (const entry of sentHistory) {
                const entryDate = new Date(entry.timestamp);
                
                // Parse product codes from message
                const regex = /Cód:\s*(\d+)/g;
                let match;
                while ((match = regex.exec(entry.message)) !== null) {
                    const code = parseInt(match[1], 10);
                    
                    // Map latest timestamp for this product code
                    if (!sentTimestamps.has(code)) {
                        sentTimestamps.set(code, entry.timestamp);
                    }
                    
                    if (entryDate >= todayStart) {
                        sentTodayCodes.add(code);
                    }
                }
            }
        } catch (e) {
            logger.warn(`Erro ao carregar sent_messages.json em getFunnelProducts: ${e.message}`);
        }

        // Constrói a condição para incluir produtos enviados hoje no Oracle
        let codProdCondition = '';
        if (sentTodayCodes.size > 0) {
            const codesStr = [...sentTodayCodes].join(', ');
            codProdCondition = `OR (M.CODPROD IN (${codesStr}))`;
        }

        connection = await getConnection();

        // Query modificada: busca desbloqueados hoje ou enviados hoje na segunda parte do UNION
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
                    COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) AS DTDESBLOQUEIO,
                    COALESCE(DE.QTDESBLOQUEADA, DEB.QTDESBLOQUEADA, DE2.QTDESBLOQUEADA, DEB2.QTDESBLOQUEADA, 0) AS QTDESBLOQUEADA,
                    -- Tem pendências de pedido?
                    (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS TEM_PENDENCIA,
                    -- Quantidade de pedidos pendentes
                    (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD
                     AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
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
                         (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                         OR
                         (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                     )
                    ) AS QTDISP
                FROM BRAGO.PCMOV M
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO NOT IN (6, 103)
                LEFT JOIN BRAGO.PCFILIAL F ON F.CODIGO = M.CODFILIAL
                LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB ON DEB.CODPROD = M.CODPROD AND M.NUMBONUS > 0 AND DEB.NUMBONUS = M.NUMBONUS
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE2 ON (
                    DE2.CODPROD = M.CODPROD
                    AND DE2.CODFILIAL = M.CODFILIAL
                    AND DE2.QTDESBLOQUEADA > 0
                    AND DE2.DTDESBLOQUEIO BETWEEN DE.DTDESBLOQUEIO - NUMTODSINTERVAL(5, 'MINUTE') AND DE.DTDESBLOQUEIO + NUMTODSINTERVAL(5, 'MINUTE')
                )
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB2 ON (
                    DEB2.CODPROD = M.CODPROD
                    AND DEB2.CODFILIAL = M.CODFILIAL
                    AND DEB2.QTDESBLOQUEADA > 0
                    AND DEB2.DTDESBLOQUEIO BETWEEN DEB.DTDESBLOQUEIO - NUMTODSINTERVAL(5, 'MINUTE') AND DEB.DTDESBLOQUEIO + NUMTODSINTERVAL(5, 'MINUTE')
                )
                WHERE M.DTMOV >= TRUNC(SYSDATE) - 30
                  AND M.CODFORNEC NOT IN (3, 4, 14566, 14631, 14574, 14573)
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
                                    (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                                    OR
                                    (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
                                )
                            )
                            OR
                            EXISTS (
                                SELECT 1 FROM BRAGO.PCEST E
                                WHERE E.CODPROD = M.CODPROD
                                AND E.QTBLOQUEADA > 0
                                AND (
                                    (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                                    OR
                                    (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                                )
                            )
                        )
                    )
                  )
                  AND M.CODOPER IN ('E', 'EB', 'EP')
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
                    COALESCE(DE.QTDESBLOQUEADA, DE2.QTDESBLOQUEADA, 0) AS QTDESBLOQUEADA,
                    -- Tem pendências de pedido?
                    (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
                     )
                    ) AS TEM_PENDENCIA,
                    -- Quantidade de pedidos pendentes
                    (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                     FROM BRAGO.PCPEDI I
                     WHERE I.CODPROD = M.CODPROD
                     AND I.POSICAO IN ('P', 'B')
                     AND (
                         (M.CODFILIAL IN ('20', '6') AND I.CODFILIALRETIRA IN ('20', '6'))
                         OR
                         (M.CODFILIAL NOT IN ('20', '6') AND I.CODFILIALRETIRA = M.CODFILIAL)
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
                         (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                         OR
                         (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
                     )
                    ) AS QTDISP
                FROM BRAGO.PCMOV M
                JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO NOT IN (6, 103)
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
                LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE2 ON (
                    DE2.CODPROD = M.CODPROD
                    AND DE2.CODFILIAL = M.CODFILIAL
                    AND DE2.QTDESBLOQUEADA > 0
                    AND DE2.DTDESBLOQUEIO BETWEEN DE.DTDESBLOQUEIO - NUMTODSINTERVAL(5, 'MINUTE') AND DE.DTDESBLOQUEIO + NUMTODSINTERVAL(5, 'MINUTE')
                )
                WHERE M.DTMOV >= TRUNC(SYSDATE) - 30
                  AND M.CODFORNEC NOT IN (3, 4, 14566, 14631, 14574, 14573)
                  AND M.DTMOV < TRUNC(SYSDATE)
                  AND M.CODOPER IN ('E', 'EB', 'EP')
                  AND M.QT > 0
            ) ORDER BY DTDESBLOQUEIO DESC, DTMOV DESC`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const rows = result.rows.map(row => {
            if (String(row.CODFILIAL) === '6') {
                return {
                    ...row,
                    CODFILIAL: '20',
                    NOMEFILIAL: 'BRAGO BRASILIA'
                };
            }
            return row;
        });

        // Carrega chaves processadas do disco
        const processedKeysPath = path.join(__dirname, '..', '..', 'data', 'processed_keys.json');
        let processedKeys = new Set();
        try {
            if (fs.existsSync(processedKeysPath)) {
                processedKeys = new Set(JSON.parse(fs.readFileSync(processedKeysPath, 'utf8')));
            }
        } catch (e) {
            logger.warn(`Erro ao carregar processed_keys.json em getFunnelProducts: ${e.message}`);
        }

        // Alertas de corte resolvido já enviados (por produto + FILIAL): usados na
        // Jornada para ilustrar a etapa "Corte avisado ao vendedor" antes do broadcast.
        // IMPORTANTE: a chave inclui a filial do pedido (ped.codfilial) — sem isso,
        // um corte antigo da Filial 20 podia "colar" indevidamente num card de
        // chegada da Filial 21 do mesmo código de produto (bug real encontrado
        // 14/07/2026: produto 13432, corte de 08/07 na Fil.20 aparecendo num
        // card de chegada na Fil.21).
        const cutAlerts = new Map(); // 'codprod-filial' -> { timestamp, rcas: [] }
        try {
            const { getSentHistory } = require('../utils/sentTracker');
            for (const entry of getSentHistory()) {
                if (!entry.details || entry.details.type !== 'cut_resolved') continue;
                const rcaLabel = entry.details.nome_rca || entry.details.rca || '?';
                for (const ped of entry.details.pedidos || []) {
                    // Normaliza Filial 6 -> 20 (mesma loja combinada, igual à exibição do funil)
                    let fil = String(ped.codfilial || '').trim();
                    if (fil === '6') fil = '20';
                    for (const item of ped.items || []) {
                        const key = `${parseInt(item.codprod, 10)}-${fil}`;
                        if (!cutAlerts.has(key)) cutAlerts.set(key, { timestamp: entry.timestamp, rcas: [] });
                        const info = cutAlerts.get(key);
                        if (!info.rcas.includes(rcaLabel)) info.rcas.push(rcaLabel);
                    }
                }
            }
        } catch (e) {
            logger.warn(`Erro ao carregar alertas de corte em getFunnelProducts: ${e.message}`);
        }

        // Lotes aguardando o delay do broadcast (fila persistida). Chave inclui a
        // filial pelo mesmo motivo do cutAlerts acima — o mesmo CODPROD pode estar
        // em lotes de filiais diferentes ao mesmo tempo.
        const queuedInfo = new Map(); // 'codprod-filial' -> dueAt
        try {
            const arrivalQueue = require('../utils/arrivalQueue');
            for (const batch of arrivalQueue.listPending()) {
                for (const p of batch.produtos) {
                    let fil = String(p.filial || '').trim();
                    if (fil === '6') fil = '20'; // mesma normalização do funil (loja combinada)
                    queuedInfo.set(`${p.codprod}-${fil}`, batch.dueAt);
                }
            }
        } catch (e) { /* fila indisponível não impede o funil */ }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Filtra a lista com base nas regras do funil inteligente do dia
        const filteredRows = rows.filter(row => {
            const key = `${row.NUMTRANSENT}-${row.CODPROD}`;
            const isUnlocked = row.DTDESBLOQUEIO !== null;
            const isUnlockedToday = isUnlocked && new Date(row.DTDESBLOQUEIO) >= todayStart;
            const isSent = processedKeys.has(key);
            const isSentToday = isSent && sentTodayCodes.has(row.CODPROD);

            // Marca o status no objeto para uso no frontend
            row.ENVIADO = isSent;
            row.ENVIADO_HOJE = isSentToday;
            row.DTENVIADO = sentTimestamps.get(row.CODPROD) || null;

            // Etapa de corte avisado + estado "na fila de delay" (para a Jornada).
            // Sempre escopado por produto+filial — ver comentário acima sobre o bug
            // de 14/07/2026 (corte de outra filial "colando" no card errado).
            const rowFilKey = `${row.CODPROD}-${String(row.CODFILIAL || '').trim()}`;
            const cutInfo = cutAlerts.get(rowFilKey) || null;
            row.CORTE_AVISADO = cutInfo ? { dt: cutInfo.timestamp, rcas: cutInfo.rcas } : null;
            row.BROADCAST_AGENDADO = queuedInfo.get(rowFilKey) || null;

            // 1. Cargas recebidas hoje sempre aparecem no funil do dia
            const isArrivedToday = row.DTMOV ? new Date(row.DTMOV) >= todayStart : false;
            if (isArrivedToday) return true;

            // 2. Cargas antigas que ainda estão bloqueadas
            if (!isUnlocked) return true;

            // 3. Cargas antigas liberadas hoje
            if (isUnlockedToday) return true;

            // 4. Cargas antigas liberadas anteriormente, mas que foram enviadas HOJE (aparece hoje para o usuário)
            if (isSentToday) return true;

            // Qualquer outro caso (liberado e enviado em dias anteriores, ou liberado anteriormente) sai do funil ativo de hoje
            return false;
        });

        return filteredRows;
    } catch (err) {
        logger.error(`Erro ao buscar dados do funil: ${err.message}`);
        return [];
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Busca os produtos em ruptura de estoque por filial
 * que possuem giro (dias com venda >= minDiasComVenda nos últimos janelaGiro dias
 * e pelo menos 1 dia com venda nos últimos janelaVendaRecente dias).
 *
 * @param {Object} params
 * @param {number} params.pisoEstoque
 * @param {number} params.janelaGiro
 * @param {number} params.minDiasComVenda
 * @param {number} params.janelaVendaRecente
 * @returns {Promise<Array>} Lista de produtos em ruptura
 */
async function getRuptureProducts(params = {}) {
    let connection;
    try {
        connection = await getConnection();

        const pisoEstoque = params.pisoEstoque !== undefined ? Number(params.pisoEstoque) : 0;
        const janelaGiro = params.janelaGiro !== undefined ? Number(params.janelaGiro) : 90;
        const minDiasComVenda = params.minDiasComVenda !== undefined ? Number(params.minDiasComVenda) : 12;
        const janelaVendaRecente = params.janelaVendaRecente !== undefined ? Number(params.janelaVendaRecente) : 30;

        const query = `
        WITH VENDAS AS (
          SELECT 
            M.CODPROD,
            CASE WHEN M.CODFILIAL = '6' THEN '20' ELSE M.CODFILIAL END AS CODFILIAL_MAPPED,
            COUNT(DISTINCT TRUNC(M.DTMOV)) AS DIAS_COM_VENDA,
            COUNT(DISTINCT CASE WHEN M.DTMOV >= TRUNC(SYSDATE) - :janelaVendaRecente THEN TRUNC(M.DTMOV) END) AS DIAS_COM_VENDA_RECENTE
          FROM PCMOV M
          WHERE M.CODOPER = 'S'
            AND M.DTMOV >= TRUNC(SYSDATE) - :janelaGiro
            AND M.CODFILIAL IN ('6', '20', '21', '22', '23')
          GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL = '6' THEN '20' ELSE M.CODFILIAL END
        )
        SELECT 
            V.CODPROD,
            V.CODFILIAL_MAPPED AS CODFILIAL,
            P.DESCRICAO,
            P.EMBALAGEM,
            P.UNIDADE,
            P.OBS2,
            P.CODFORNEC,
            FORN.FANTASIA AS FORNECEDOR,
            F.RAZAOSOCIAL AS NOMEFILIAL,
            (
              SELECT SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0))
              FROM PCEST E
              WHERE E.CODPROD = V.CODPROD
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND E.CODFILIAL = V.CODFILIAL_MAPPED)
                )
            ) AS ESTOQUE_DISP,
            V.DIAS_COM_VENDA,
            V.DIAS_COM_VENDA_RECENTE,
            (
              SELECT MAX(M.DTMOV)
              FROM PCMOV M
              WHERE M.CODPROD = V.CODPROD
                AND M.CODOPER IN ('E', 'EB', 'EP')
                AND M.DTMOV >= TRUNC(SYSDATE) - 365
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND M.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND M.CODFILIAL = V.CODFILIAL_MAPPED)
                )
            ) AS DT_ULTIMA_ENTRADA,
            (
              SELECT NVL(SUM(NVL(I.QTPEDIDA, 0) - NVL(I.QTENTREGUE, 0)), 0)
              FROM PCITEM I
              JOIN PCPEDC P ON P.NUMPED = I.NUMPED
              WHERE I.CODPROD = V.CODPROD
                AND P.DTCANCEL IS NULL
                AND P.POSICAO <> 'C'
                AND P.DATA >= TRUNC(SYSDATE) - 60
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND P.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND P.CODFILIAL = V.CODFILIAL_MAPPED)
                )
            ) AS QT_PEDIDA_ABERTO
        FROM VENDAS V
        JOIN PCPRODUT P ON P.CODPROD = V.CODPROD
        LEFT JOIN PCFILIAL F ON F.CODIGO = V.CODFILIAL_MAPPED
        LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = P.CODFORNEC
        WHERE P.REVENDA = 'S'
          AND P.CODEPTO NOT IN (6, 103)
          AND NVL(P.OBS2, ' ') <> 'FL'
          AND V.DIAS_COM_VENDA >= :minDiasComVenda
          AND V.DIAS_COM_VENDA_RECENTE >= 1
          AND (
              SELECT SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0))
              FROM PCEST E
              WHERE E.CODPROD = V.CODPROD
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND E.CODFILIAL = V.CODFILIAL_MAPPED)
                )
          ) <= :pisoEstoque
        ORDER BY V.CODFILIAL_MAPPED, V.DIAS_COM_VENDA DESC, P.DESCRICAO
        `;

        const bindParams = {
            janelaVendaRecente,
            janelaGiro,
            minDiasComVenda,
            pisoEstoque
        };

        const result = await connection.execute(query, bindParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        // Trata a filial 20 para ter o nome uniforme
        const mappedRows = result.rows.map(row => {
            if (String(row.CODFILIAL) === '20') {
                return {
                    ...row,
                    NOMEFILIAL: 'BRAGO BRASILIA'
                };
            }
            return row;
        });

        return mappedRows;
    } catch (err) {
        logger.error(`Erro ao buscar produtos em ruptura: ${err.message}`);
        return [];
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Testa a conexão com o Oracle
 */
async function testConnection() {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute('SELECT SYSDATE FROM DUAL');
        logger.info(`✅ Oracle conectado. Data do servidor: ${result.rows[0][0]}`);
        return true;
    } catch (err) {
        logger.error(`❌ Falha na conexão Oracle: ${err.message}`);
        return false;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

module.exports = { getNewEntries, groupByFilial, formatMessage, getFunnelProducts, testConnection, getRuptureProducts };
