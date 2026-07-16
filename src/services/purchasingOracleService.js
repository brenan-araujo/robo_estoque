const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');


/**
 * Busca dados de cobertura de compras por FAMÍLIA (produto-pai)/filial.
 * Produtos com relação pai/filho (mesmo item em embalagens diferentes — ex.: caixa
 * e unidade) são CONSOLIDADOS: a venda e o estoque dos filhos são somados ao pai,
 * convertidos para unidade-base pelo fator QTUNIT e expressos na unidade do pai
 * (a embalagem de compra). A raiz da família vem de CODPRODPRINC ou CODPRODMASTER.
 * A venda diária é MÉDIA PONDERADA POR RECÊNCIA (terço recente pesa 3, meio 2,
 * antigo 1) e LÍQUIDA de devoluções (QTDEVOL). Retorna o estoque disponível, saldo
 * de pedidos, prazo do fornecedor e o status de cobertura (CRITICO, ATENCAO, SAUDAVEL).
 *
 * @param {Object} params
 * @param {number} params.janelaGiro - Janela em dias para cálculo do giro (default 90)
 * @param {number} params.minDiasComVenda - Mínimo de dias com venda no período (default 5)
 * @param {number} params.limiarAtencao - Dias de margem para status ATENCAO (default 5)
 * @returns {Promise<Array>} Lista de produtos com dados de cobertura
 */
async function getPurchasingCoverageData(params = {}) {
    let connection;
    try {
        connection = await getConnection();

        const janelaGiro = params.janelaGiro !== undefined ? Number(params.janelaGiro) : 90;
        const minDiasComVenda = params.minDiasComVenda !== undefined ? Number(params.minDiasComVenda) : 5;
        const limiarAtencao = params.limiarAtencao !== undefined ? Number(params.limiarAtencao) : 5;

        const query = `
        WITH PRODFAM AS (
          -- Mapeia cada produto à sua RAIZ (produto-pai) e ao FATOR de conversão p/ unidade-base.
          -- Filho aponta para o pai via CODPRODPRINC ou CODPRODMASTER (cadastro é inconsistente,
          -- por isso checamos os dois). Pai aponta para si mesmo. FATOR = QTUNIT (caixa=10/16, unid=1).
          SELECT CODPROD,
            CASE
              WHEN NVL(CODPRODPRINC, 0)  NOT IN (0, CODPROD) THEN CODPRODPRINC
              WHEN NVL(CODPRODMASTER, 0) NOT IN (0, CODPROD) THEN CODPRODMASTER
              ELSE CODPROD
            END AS RAIZ,
            CASE WHEN NVL(QTUNIT, 0) <= 0 THEN 1 ELSE QTUNIT END AS FATOR
          FROM PCPRODUT
        ),
        VENDAS AS (
          -- Venda agregada por FAMÍLIA (raiz) x filial, em UNIDADES-BASE (qt * fator do membro).
          SELECT
            PF.RAIZ AS CODPROD,
            CASE WHEN M.CODFILIAL = '6' THEN '20' ELSE M.CODFILIAL END AS CODFILIAL_MAPPED,
            COUNT(DISTINCT TRUNC(M.DTMOV)) AS DIAS_COM_VENDA,
            SUM((M.QT - NVL(M.QTDEVOL, 0)) * PF.FATOR) AS TOTAL_QT,
            -- Venda bruta total (para a coluna de consulta "Venda Diária 90 dias", igual ao cálculo antigo)
            SUM(M.QT * PF.FATOR) AS TOTAL_QT_BRUTA,
            -- Venda diária PONDERADA POR RECÊNCIA + líquida de devoluções (em unidades-base).
            -- Janela em 3 terços: recente pesa 3, meio 2, antigo 1. Denominador = 2 * janela. Piso 0.
            GREATEST(
              (
                  3 * SUM(CASE WHEN M.DTMOV >= TRUNC(SYSDATE) - (:janelaGiro / 3)
                               THEN (M.QT - NVL(M.QTDEVOL, 0)) * PF.FATOR ELSE 0 END)
                + 2 * SUM(CASE WHEN M.DTMOV <  TRUNC(SYSDATE) - (:janelaGiro / 3)
                               AND  M.DTMOV >= TRUNC(SYSDATE) - (2 * :janelaGiro / 3)
                               THEN (M.QT - NVL(M.QTDEVOL, 0)) * PF.FATOR ELSE 0 END)
                + 1 * SUM(CASE WHEN M.DTMOV <  TRUNC(SYSDATE) - (2 * :janelaGiro / 3)
                               THEN (M.QT - NVL(M.QTDEVOL, 0)) * PF.FATOR ELSE 0 END)
              ) / (2 * :janelaGiro)
            , 0) AS VENDA_DIA_BASE,
            -- Faturamento líquido da família (para a curva ABC) - independe do fator
            SUM((M.QT - NVL(M.QTDEVOL, 0)) * M.PUNIT) AS FATURAMENTO
          FROM PCMOV M
          JOIN PRODFAM PF ON PF.CODPROD = M.CODPROD
          WHERE M.CODOPER = 'S'
            AND M.DTMOV >= TRUNC(SYSDATE) - :janelaGiro
            AND M.CODFILIAL IN ('6', '20', '21', '22', '23')
          GROUP BY PF.RAIZ, CASE WHEN M.CODFILIAL = '6' THEN '20' ELSE M.CODFILIAL END
        ),
        ESTOQFAM AS (
          -- Estoque disponível somado por FAMÍLIA x filial, em unidades-base (filiais 20+6 juntas).
          SELECT PF.RAIZ AS CODPROD,
            CASE WHEN E.CODFILIAL IN ('20', '6') THEN '20' ELSE E.CODFILIAL END AS FIL,
            SUM((NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0)) * PF.FATOR) AS ESTOQUE_BASE
          FROM PCEST E
          JOIN PRODFAM PF ON PF.CODPROD = E.CODPROD
          WHERE E.CODFILIAL IN ('20', '6', '21', '22', '23')
          GROUP BY PF.RAIZ, CASE WHEN E.CODFILIAL IN ('20', '6') THEN '20' ELSE E.CODFILIAL END
        ),
        SALDOFAM AS (
          -- Saldo de pedidos (a receber) somado por FAMÍLIA x filial, em unidades-base.
          SELECT PF.RAIZ AS CODPROD,
            CASE WHEN PD.CODFILIAL IN ('20', '6') THEN '20' ELSE PD.CODFILIAL END AS FIL,
            SUM((NVL(I.QTPEDIDA, 0) - NVL(I.QTENTREGUE, 0)) * PF.FATOR) AS SALDO_BASE,
            MAX(PD.DTPREVENT) AS DT_PREVISAO_ENTREGA
          FROM PCITEM I
          JOIN PCPEDIDO PD ON I.NUMPED = PD.NUMPED
          JOIN PRODFAM PF ON PF.CODPROD = I.CODPROD
          WHERE (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) > 0
            AND PD.DTPREVENT >= TRUNC(SYSDATE)
            AND PD.DTENTRADAESTOQUE IS NULL
            AND PD.CODFILIAL IN ('20', '6', '21', '22', '23')
          GROUP BY PF.RAIZ, CASE WHEN PD.CODFILIAL IN ('20', '6') THEN '20' ELSE PD.CODFILIAL END
        )
        SELECT
            V.CODPROD,
            V.CODFILIAL_MAPPED AS CODFILIAL,
            P.DESCRICAO,
            P.EMBALAGEM,
            P.UNIDADE,
            P.CODFORNEC,
            FORN.FANTASIA AS NOME_FORNECEDOR,
            F.RAZAOSOCIAL AS NOMEFILIAL,
            -- Valores da família convertidos para a UNIDADE DO PAI (caixa): base / fator do pai.
            -- Cobertura é invariante à unidade; a sugestão sai na embalagem de compra (caixa).
            ROUND(NVL(EF.ESTOQUE_BASE, 0) / PP.FATOR, 2) AS ESTOQUE_DISPONIVEL,
            ROUND(NVL(SF.SALDO_BASE, 0)  / PP.FATOR, 2) AS SALDO_PEDIDO,
            SF.DT_PREVISAO_ENTREGA,
            (V.VENDA_DIA_BASE / PP.FATOR) AS VENDA_DIA,
            -- Coluna de consulta: média simples de 90 dias (bruta), como era no cálculo antigo
            ((NVL(V.TOTAL_QT_BRUTA, 0) / :janelaGiro) / PP.FATOR) AS VENDA_DIA_90,
            V.FATURAMENTO,
            FORN.PRAZOENTREGA AS TEMPO_FORNEC
        FROM VENDAS V
        JOIN PCPRODUT P ON P.CODPROD = V.CODPROD
        JOIN PRODFAM PP ON PP.CODPROD = V.CODPROD
        LEFT JOIN PCFILIAL F ON F.CODIGO = V.CODFILIAL_MAPPED
        LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = P.CODFORNEC
        LEFT JOIN ESTOQFAM EF ON EF.CODPROD = V.CODPROD AND EF.FIL = V.CODFILIAL_MAPPED
        LEFT JOIN SALDOFAM SF ON SF.CODPROD = V.CODPROD AND SF.FIL = V.CODFILIAL_MAPPED
        WHERE P.REVENDA = 'S'
          AND P.CODEPTO IN (1, 2, 3, 7)
          AND P.CODFORNEC NOT IN (3, 4, 14566, 14631, 14574, 14573)
          AND NVL(P.OBS2, ' ') <> 'FL'
          -- Exclui as seções de PERSONALIZAÇÃO (produtos sob demanda/cliente, não repostos):
          -- 14 GENERICA, 17 MEIWA CORINGA, 20 CLIENTES MEIWA, 24 GERAL INDISP., 42 ITENS,
          -- 10000 CLIENTES BRAGO, 10001 MEIWA, 10041 GUARDANAPOS PERSONALIZADOS.
          AND P.CODSEC NOT IN (14, 17, 20, 24, 42, 10000, 10001, 10041)
          AND V.DIAS_COM_VENDA >= :minDiasComVenda
        ORDER BY FORN.FANTASIA, V.CODFILIAL_MAPPED, P.DESCRICAO
        `;

        const bindParams = {
            janelaGiro,
            minDiasComVenda
        };

        const result = await connection.execute(query, bindParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        // Pós-processamento em JavaScript: calcula cobertura, margem e status
        const mappedRows = result.rows.map(row => {
            const estoqueDisponivel = Number(row.ESTOQUE_DISPONIVEL) || 0;
            const saldoPedido = Number(row.SALDO_PEDIDO) || 0;
            const vendaDia = Number(row.VENDA_DIA) || 0;
            const tempoFornec = Number(row.TEMPO_FORNEC) || 7;

            // Cobertura Física: quanto tempo dura o estoque físico atual
            const coberturaFisica = vendaDia > 0
                ? Math.round((estoqueDisponivel / vendaDia) * 10) / 10
                : 9999;

            // Cobertura Total: cobertura considerando estoque físico + pedidos pendentes
            const coberturaTotal = vendaDia > 0
                ? Math.round(((estoqueDisponivel + saldoPedido) / vendaDia) * 10) / 10
                : 9999;

            // Lógica de Abastecimento (Replenishment)
            let status;
            let calculo;

            if (coberturaFisica >= tempoFornec) {
                status = 'SAUDAVEL';
                calculo = Math.round((coberturaFisica - tempoFornec) * 10) / 10;
            } else {
                // Ruptura física iminente (estoque atual acaba antes do lead time)
                if (coberturaTotal < tempoFornec) {
                    // Sem pedido ou pedido insuficiente -> Precisa comprar urgente
                    status = 'CRITICO';
                    calculo = Math.round((coberturaTotal - tempoFornec) * 10) / 10;
                } else {
                    // Já possui pedido lançado que cobre a necessidade -> Acompanhar trânsito
                    status = 'ATENCAO';
                    calculo = Math.round((coberturaFisica - tempoFornec) * 10) / 10; // Margem física negativa (dias de gap)
                }
            }

            // Trata a filial 20 para ter o nome uniforme de combinação de 20 e 6
            const nomeFilial = String(row.CODFILIAL) === '20' ? 'BRAGO BRASILIA (20+6)' : row.NOMEFILIAL;
            const codFilial = String(row.CODFILIAL) === '20' ? '20 + 6' : String(row.CODFILIAL);

            return {
                ...row,
                CODFILIAL: codFilial,
                ESTOQUE_DISPONIVEL: estoqueDisponivel,
                SALDO_PEDIDO: saldoPedido,
                VENDA_DIA: vendaDia,
                VENDA_DIA_90: Number(row.VENDA_DIA_90) || 0,
                FATURAMENTO: Number(row.FATURAMENTO) || 0,
                TEMPO_FORNEC: tempoFornec,
                COBERTURA_DIA: coberturaTotal, // Mantido para retrocompatibilidade
                COBERTURA_FISICA: coberturaFisica,
                COBERTURA_TOTAL: coberturaTotal,
                CALCULO: calculo,
                STATUS: status,
                NOMEFILIAL: nomeFilial
            };
        });

        // Classificação da Curva ABC por filial (Pareto 80/15/5 baseado em faturamento)
        const filialGroups = {};
        mappedRows.forEach(row => {
            const key = row.CODFILIAL;
            if (!filialGroups[key]) filialGroups[key] = [];
            filialGroups[key].push(row);
        });

        Object.values(filialGroups).forEach(group => {
            // Ordena por faturamento decrescente
            group.sort((a, b) => b.FATURAMENTO - a.FATURAMENTO);

            const totalFat = group.reduce((sum, r) => sum + r.FATURAMENTO, 0);
            if (totalFat === 0) {
                // Sem faturamento, todos ficam como C
                group.forEach(r => { r.CURVA_ABC = 'C'; });
                return;
            }

            let acumulado = 0;
            group.forEach(row => {
                acumulado += row.FATURAMENTO;
                const pctAcumulado = acumulado / totalFat;
                if (pctAcumulado <= 0.80) {
                    row.CURVA_ABC = 'A';
                } else if (pctAcumulado <= 0.95) {
                    row.CURVA_ABC = 'B';
                } else {
                    row.CURVA_ABC = 'C';
                }
            });
        });

        logger.debug(`Query de cobertura retornou ${mappedRows.length} produtos (janelaGiro=${janelaGiro}, minDiasComVenda=${minDiasComVenda})`);
        return mappedRows;

    } catch (err) {
        logger.error(`Erro ao buscar dados de cobertura de compras: ${err.message}`);
        return [];
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

module.exports = { getPurchasingCoverageData };
