const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');

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
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA,
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
                ) AS QTDISP,
                (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                 FROM PCPEDI I
                 WHERE I.CODPROD = M.CODPROD
                 AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS QTPEND
             FROM PCMOV M
             JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
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
             WHERE DE.DTDESBLOQUEIO >= :lastUnlockDate
             AND M.CODOPER IN ('E', 'EB')
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
                      (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                  )
                 ) > 0
             )
             AND (
                 -- Regra A: O estoque antes de desbloquear era zerado ou negativo (Desconta a quantidade desbloqueada da PCLOGDESBLOQUEIO)
                 (SELECT NVL(SUM(
                     NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                     - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
                  ), 0) - NVL(DE.QTDESBLOQUEADA, 0)
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                  AND (
                      (M.CODFILIAL = '20' AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (M.CODFILIAL <> '20' AND E.CODFILIAL = M.CODFILIAL)
                  )
                 ) <= 0
                 OR
                 -- Regra B: Há mais pedidos pendentes do que estoque disponível
                 (SELECT NVL(SUM(NVL(I.QT, 0)), 0)
                  FROM PCPEDI I
                  WHERE I.CODPROD = M.CODPROD
                  AND I.POSICAO IN ('P', 'B')
                  AND (
                      (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                      OR
                      (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                  )
                 ) > 
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
                 )
             )
             ORDER BY M.CODFILIAL, DE.DTDESBLOQUEIO, M.NUMTRANSENT`,
            { lastUnlockDate: lastUnlockDateObj },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        logger.debug(`Query retornou ${result.rows.length} novas entradas desbloqueadas (DTDESBLOQUEIO >= ${lastUnlockDateObj.toISOString()})`);
        return result.rows;

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
        
        const pendentes = items.filter(i => i.temPendencia);
        const normais = items.filter(i => !i.temPendencia);

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

module.exports = { getNewEntries, groupByFilial, formatMessage, testConnection };
