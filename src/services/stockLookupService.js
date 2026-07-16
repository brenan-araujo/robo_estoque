const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');

const MAX_MATCHES = 6;

/** Formata uma Date do Oracle como dd/mm/aaaa (ou null). */
function formatDate(d) {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${dt.getFullYear()}`;
}

/** Deriva o status logístico do produto a partir dos números. */
function derivarStatus({ estoqueDisponivel, qtdEmLiberacao, saldoPedido, previsaoChegada }) {
    if (estoqueDisponivel > 0) return 'disponivel';
    if (qtdEmLiberacao > 0) return 'em_liberacao';
    if (saldoPedido > 0 && previsaoChegada) return 'a_caminho';
    return 'sem_previsao';
}

/**
 * Consulta estoque + liberação + previsão de chegada de um produto na filial do vendedor.
 * Filiais 20 e 6 são tratadas como o mesmo CD (regra do restante do sistema).
 *
 * @param {{termo:string, codFilial:string|number}} params
 * @returns {Promise<{termo:string,codFilial:string,matches:Array}>}
 */
async function consultarProduto({ termo, codFilial }) {
    const termoStr = String(termo || '').trim();
    const filialStr = String(codFilial || '').trim();
    if (!termoStr) return { termo: termoStr, codFilial: filialStr, matches: [] };

    const isCombined = ['20', '6'].includes(filialStr);
    // Condição de filial reutilizada nas subconsultas (codFilial validado como dígitos no server).
    const filEst = isCombined ? "E.CODFILIAL IN ('20', '6')" : 'E.CODFILIAL = :codFilial';
    const filPed = isCombined ? "PD.CODFILIAL IN ('20', '6')" : 'PD.CODFILIAL = :codFilial';

    const isNumeric = /^\d+$/.test(termoStr);
    const termoFilter = isNumeric
        ? 'P.CODPROD = :codProd'
        : 'UPPER(P.DESCRICAO) LIKE UPPER(:termoLike)';

    const sql = `
        SELECT * FROM (
            SELECT
                P.CODPROD,
                P.DESCRICAO,
                P.UNIDADE,
                (SELECT NVL(SUM(NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0) - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)), 0)
                   FROM PCEST E WHERE E.CODPROD = P.CODPROD AND ${filEst}) AS ESTOQUE_DISPONIVEL,
                (SELECT NVL(SUM(NVL(E.QTBLOQUEADA,0)), 0)
                   FROM PCEST E WHERE E.CODPROD = P.CODPROD AND ${filEst}) AS QTD_EM_LIBERACAO,
                (SELECT NVL(SUM(NVL(I.QTPEDIDA,0) - NVL(I.QTENTREGUE,0)), 0)
                   FROM PCITEM I JOIN PCPEDIDO PD ON PD.NUMPED = I.NUMPED
                   WHERE I.CODPROD = P.CODPROD
                     AND (I.QTPEDIDA - NVL(I.QTENTREGUE,0)) > 0
                     AND PD.DTPREVENT >= TRUNC(SYSDATE)
                     AND PD.DTENTRADAESTOQUE IS NULL
                     AND ${filPed}) AS SALDO_PEDIDO,
                (SELECT MAX(PD.DTPREVENT)
                   FROM PCITEM I JOIN PCPEDIDO PD ON PD.NUMPED = I.NUMPED
                   WHERE I.CODPROD = P.CODPROD
                     AND (I.QTPEDIDA - NVL(I.QTENTREGUE,0)) > 0
                     AND PD.DTPREVENT >= TRUNC(SYSDATE)
                     AND PD.DTENTRADAESTOQUE IS NULL
                     AND ${filPed}) AS PREVISAO_CHEGADA
            FROM PCPRODUT P
            WHERE P.REVENDA = 'S'
              AND P.CODEPTO NOT IN (6, 103)
              AND ${termoFilter}
            ORDER BY LENGTH(P.DESCRICAO), P.DESCRICAO
        ) WHERE ROWNUM <= ${MAX_MATCHES}
    `;

    const bind = {};
    if (isNumeric) bind.codProd = Number(termoStr);
    else bind.termoLike = '%' + termoStr.replace(/\s+/g, '%') + '%';
    if (!isCombined) bind.codFilial = filialStr;

    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(sql, bind, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const matches = (result.rows || []).map((r) => {
            const estoqueDisponivel = Number(r.ESTOQUE_DISPONIVEL) || 0;
            const qtdEmLiberacao = Number(r.QTD_EM_LIBERACAO) || 0;
            const saldoPedido = Number(r.SALDO_PEDIDO) || 0;
            const previsaoChegada = formatDate(r.PREVISAO_CHEGADA);
            return {
                codprod: r.CODPROD,
                descricao: r.DESCRICAO,
                unidade: r.UNIDADE,
                estoqueDisponivel,
                qtdEmLiberacao,
                saldoPedido,
                previsaoChegada,
                status: derivarStatus({ estoqueDisponivel, qtdEmLiberacao, saldoPedido, previsaoChegada }),
            };
        });
        return { termo: termoStr, codFilial: filialStr, matches };
    } catch (err) {
        logger.error(`Erro na consulta de estoque (termo="${termoStr}", filial=${filialStr}): ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

module.exports = { consultarProduto };
