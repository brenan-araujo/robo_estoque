const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Formata o nome da filial conforme solicitado (ex: 20 - Brago Brasília)
 * @param {string|number} codFilial 
 * @param {string} defaultName 
 * @returns {string}
 */
function formatFilialName(codFilial, defaultName) {
    const cod = String(codFilial).trim();
    if (cod === '20') return '20 - Brago Brasília';
    if (cod === '21') return '21 - Brago Goiânia';
    if (defaultName) {
        if (defaultName.startsWith(cod)) {
            return defaultName;
        }
        return `${cod} - ${defaultName}`;
    }
    return `${cod} - Filial ${cod}`;
}

/**
 * Busca resumo de vendas faturadas e devoluções do dia de referência
 * @param {Date} targetDate
 * @returns {Object}
 */
async function getSalesToday(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        
        // Vendas Brutas na PCMOV (Líquidas de cancelamento através do join com PCNFSAID)
        const salesResult = await connection.execute(
            `SELECT 
                COUNT(DISTINCT M.NUMNOTA) AS TOTAL_PEDIDOS,
                NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_VENDAS_BRUTA,
                COUNT(DISTINCT M.CODCLI) AS CLIENTES_ATENDIDOS,
                COUNT(DISTINCT M.CODUSUR) AS VENDEDORES_ATIVOS,
                COUNT(DISTINCT M.CODFILIAL) AS FILIAIS_ATIVAS
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             JOIN PCNFSAID N ON N.NUMNOTA = M.NUMNOTA AND N.CODFILIAL = M.CODFILIAL AND N.CODUSUR = M.CODUSUR
             WHERE N.DTSAIDA >= TRUNC(:targetDate)
             AND N.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND N.DTCANCEL IS NULL
             AND N.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Devoluções de Vendas do Dia (PCMOV com CODOPER = 'ED')
        const devolResult = await connection.execute(
            `SELECT NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_DEVOLUCOES
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DTMOV >= TRUNC(:targetDate)
             AND M.DTMOV < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'ED'
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const sales = salesResult.rows[0];
        const devol = devolResult.rows[0].TOTAL_DEVOLUCOES;
        const totalVendasLiquida = sales.TOTAL_VENDAS_BRUTA - devol;

        return {
            TOTAL_PEDIDOS: sales.TOTAL_PEDIDOS,
            TOTAL_VENDAS_BRUTA: sales.TOTAL_VENDAS_BRUTA,
            TOTAL_DEVOLUCOES: devol,
            TOTAL_VENDAS: totalVendasLiquida, 
            TICKET_MEDIO: sales.TOTAL_PEDIDOS > 0 ? (totalVendasLiquida / sales.TOTAL_PEDIDOS) : 0,
            CLIENTES_ATENDIDOS: sales.CLIENTES_ATENDIDOS,
            VENDEDORES_ATIVOS: sales.VENDEDORES_ATIVOS,
            FILIAIS_ATIVAS: sales.FILIAIS_ATIVAS
        };
    } catch (err) {
        logger.error(`Erro ao buscar vendas do dia: ${err.message}`);
        return { TOTAL_PEDIDOS: 0, TOTAL_VENDAS_BRUTA: 0, TOTAL_DEVOLUCOES: 0, TOTAL_VENDAS: 0, TICKET_MEDIO: 0, CLIENTES_ATENDIDOS: 0, VENDEDORES_ATIVOS: 0, FILIAIS_ATIVAS: 0 };
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca acumulado de vendas faturadas e devoluções do mês de referência
 * @param {Date} targetDate
 * @returns {Object}
 */
async function getSalesMonth(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        
        // Vendas acumuladas brutas na PCMOV
        const salesResult = await connection.execute(
            `SELECT 
                COUNT(DISTINCT M.NUMNOTA) AS TOTAL_PEDIDOS,
                NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_VENDAS_BRUTA_MES,
                COUNT(DISTINCT M.CODCLI) AS CLIENTES_MES
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             JOIN PCNFSAID N ON N.NUMNOTA = M.NUMNOTA AND N.CODFILIAL = M.CODFILIAL AND N.CODUSUR = M.CODUSUR
             WHERE N.DTSAIDA >= TRUNC(:targetDate, 'MM')
             AND N.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND N.DTCANCEL IS NULL
             AND N.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Devoluções acumuladas no mês (PCMOV com CODOPER = 'ED')
        const devolResult = await connection.execute(
            `SELECT NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_DEVOLUCOES_MES
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DTMOV >= TRUNC(:targetDate, 'MM')
             AND M.DTMOV < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'ED'
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const sales = salesResult.rows[0];
        const devol = devolResult.rows[0].TOTAL_DEVOLUCOES_MES;
        const totalVendasLiquidaMes = sales.TOTAL_VENDAS_BRUTA_MES - devol;

        return {
            TOTAL_PEDIDOS: sales.TOTAL_PEDIDOS,
            TOTAL_VENDAS_BRUTA_MES: sales.TOTAL_VENDAS_BRUTA_MES,
            TOTAL_DEVOLUCOES_MES: devol,
            TOTAL_VENDAS_MES: totalVendasLiquidaMes, 
            TICKET_MEDIO_MES: sales.TOTAL_PEDIDOS > 0 ? (totalVendasLiquidaMes / sales.TOTAL_PEDIDOS) : 0,
            CLIENTES_MES: sales.CLIENTES_MES
        };
    } catch (err) {
        logger.error(`Erro ao buscar vendas do mês: ${err.message}`);
        return { TOTAL_PEDIDOS: 0, TOTAL_VENDAS_BRUTA_MES: 0, TOTAL_DEVOLUCOES_MES: 0, TOTAL_VENDAS_MES: 0, TICKET_MEDIO_MES: 0, CLIENTES_MES: 0 };
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca a meta mensal total e por filial, extraindo do PCMETARCA e PCMETA (TIPOMETA = 'M')
 * @param {Date} targetDate
 * @returns {Object}
 */
async function getMonthlyTarget(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();

        // 1. Meta total de vendas da PCMETARCA
        const salesTargetResult = await connection.execute(
            `SELECT NVL(SUM(M.VLVENDAPREV), 0) AS META_TOTAL
             FROM PCMETARCA M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DATA >= TRUNC(:targetDate, 'MM')
             AND M.DATA < ADD_MONTHS(TRUNC(:targetDate, 'MM'), 1)
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // 2. Metas totais de mix e positivação da PCMETA
        const otherTargetsResult = await connection.execute(
            `SELECT 
                NVL(SUM(M.CLIPOSPREV), 0) AS META_CLI_POS,
                NVL(SUM(M.MIXPREV), 0) AS META_MIX,
                COUNT(DISTINCT M.CODUSUR) AS VENDEDORES
             FROM PCMETA M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DATA >= TRUNC(:targetDate, 'MM')
             AND M.DATA < ADD_MONTHS(TRUNC(:targetDate, 'MM'), 1)
             AND M.TIPOMETA = 'M'
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // 3. Meta de vendas por filial da PCMETARCA
        const salesByFilialResult = await connection.execute(
            `SELECT 
                M.CODFILIAL,
                F.RAZAOSOCIAL AS NOMEFILIAL,
                NVL(SUM(M.VLVENDAPREV), 0) AS META_VENDA
             FROM PCMETARCA M
             LEFT JOIN PCFILIAL F ON F.CODIGO = M.CODFILIAL
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DATA >= TRUNC(:targetDate, 'MM')
             AND M.DATA < ADD_MONTHS(TRUNC(:targetDate, 'MM'), 1)
             AND U.BLOQUEIO = 'N'
             GROUP BY M.CODFILIAL, F.RAZAOSOCIAL`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // 4. Outras metas por filial
        const otherByFilialResult = await connection.execute(
            `SELECT 
                M.CODFILIAL,
                NVL(SUM(M.CLIPOSPREV), 0) AS META_CLI_POS,
                NVL(SUM(M.MIXPREV), 0) AS META_MIX,
                COUNT(DISTINCT M.CODUSUR) AS VENDEDORES
             FROM PCMETA M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DATA >= TRUNC(:targetDate, 'MM')
             AND M.DATA < ADD_MONTHS(TRUNC(:targetDate, 'MM'), 1)
             AND M.TIPOMETA = 'M'
             AND U.BLOQUEIO = 'N'
             GROUP BY M.CODFILIAL`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const filiaisMap = {};
        salesByFilialResult.rows.forEach(r => {
            filiaisMap[r.CODFILIAL] = {
                CODFILIAL: r.CODFILIAL,
                NOMEFILIAL: formatFilialName(r.CODFILIAL, r.NOMEFILIAL),
                META_VENDA: r.META_VENDA,
                META_CLI_POS: 0,
                META_MIX: 0,
                VENDEDORES: 0
            };
        });

        otherByFilialResult.rows.forEach(r => {
            if (!filiaisMap[r.CODFILIAL]) {
                filiaisMap[r.CODFILIAL] = {
                    CODFILIAL: r.CODFILIAL,
                    NOMEFILIAL: formatFilialName(r.CODFILIAL),
                    META_VENDA: 0,
                    META_CLI_POS: 0,
                    META_MIX: 0,
                    VENDEDORES: 0
                };
            }
            filiaisMap[r.CODFILIAL].META_CLI_POS = r.META_CLI_POS;
            filiaisMap[r.CODFILIAL].META_MIX = r.META_MIX;
            filiaisMap[r.CODFILIAL].VENDEDORES = r.VENDEDORES;
        });

        const porFilial = Object.values(filiaisMap).sort((a, b) => b.META_VENDA - a.META_VENDA);

        return {
            total: {
                META_TOTAL: salesTargetResult.rows[0].META_TOTAL,
                META_CLI_POS: otherTargetsResult.rows[0].META_CLI_POS,
                META_MIX: otherTargetsResult.rows[0].META_MIX,
                VENDEDORES: otherTargetsResult.rows[0].VENDEDORES
            },
            porFilial
        };
    } catch (err) {
        logger.error(`Erro ao buscar metas mensais: ${err.message}`);
        return {
            total: { META_TOTAL: 0, META_CLI_POS: 0, META_MIX: 0, VENDEDORES: 0 },
            porFilial: []
        };
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca as metas diárias de faturamento, novos e reativados do dia de referência
 * @param {Date} targetDate
 * @returns {Object}
 */
async function getDailyTarget(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT 
                NVL(SUM(M.VLVENDAPREV), 0) AS META_DIA,
                NVL(SUM(M.QTPEDPREV), 0) AS META_NOVOS,
                NVL(SUM(M.QTITENSPEDPREV), 0) AS META_REATIVADOS
             FROM PCMETARCA M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DATA = TRUNC(:targetDate)
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows[0];
    } catch (err) {
        logger.error(`Erro ao buscar metas diárias: ${err.message}`);
        return { META_DIA: 0, META_NOVOS: 0, META_REATIVADOS: 0 };
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca a quantidade real de dias úteis no mês para a filial 20
 * @param {Date} targetDate
 * @returns {Promise<number>}
 */
async function getWorkingDaysInMonth(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT COUNT(*) AS DIAS_UTEIS
             FROM PCDIASUTEIS
             WHERE DIAVENDAS = 'S'
             AND CODFILIAL = '20'
             AND DATA >= TRUNC(:targetDate, 'MM')
             AND DATA < ADD_MONTHS(TRUNC(:targetDate, 'MM'), 1)`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows[0].DIAS_UTEIS || 22;
    } catch (err) {
        logger.error(`Erro ao buscar dias úteis na PCDIASUTEIS: ${err.message}`);
        return 22; // fallback
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca o mix de produtos por departamento faturados no período (líquido de cancelados e bonificações)
 * @param {string} periodo 'dia' ou 'mes'
 * @param {Date} targetDate
 * @returns {Array}
 */
async function getProductMix(periodo = 'dia', targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        const dataFilter = periodo === 'mes' 
            ? `M.DTMOV >= TRUNC(:targetDate, 'MM') AND M.DTMOV < TRUNC(:targetDate) + 1` 
            : `M.DTMOV >= TRUNC(:targetDate) AND M.DTMOV < TRUNC(:targetDate) + 1`;

        const result = await connection.execute(
            `SELECT 
                D.DESCRICAO AS DEPARTAMENTO,
                COUNT(DISTINCT M.CODPROD) AS QTD_PRODUTOS,
                NVL(SUM(M.QT * M.PUNIT), 0) AS VALOR_TOTAL,
                COUNT(DISTINCT M.NUMNOTA) AS PEDIDOS
             FROM PCMOV M
             JOIN PCPRODUT PR ON PR.CODPROD = M.CODPROD
             LEFT JOIN PCDEPTO D ON D.CODEPTO = PR.CODEPTO
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE ${dataFilter}
             AND M.CODOPER = 'S'
             AND U.BLOQUEIO = 'N'
             GROUP BY D.DESCRICAO
             ORDER BY VALOR_TOTAL DESC
             FETCH FIRST 8 ROWS ONLY`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows;
    } catch (err) {
        logger.error(`Erro ao buscar mix de produtos: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca novos clientes cadastrados no período para RCAs unblocked
 * @param {Date} targetDate
 * @param {string} periodo 'dia' ou 'mes'
 * @returns {Promise<number>}
 */
async function getNewCustomers(targetDate = new Date(), periodo = 'dia') {
    let connection;
    try {
        connection = await getConnection();
        const dateFilter = periodo === 'mes'
            ? `F.DTSAIDA >= TRUNC(:targetDate, 'MM') AND F.DTSAIDA < TRUNC(:targetDate) + 1`
            : `F.DTSAIDA >= TRUNC(:targetDate) AND F.DTSAIDA < TRUNC(:targetDate) + 1`;
        
        const subQueryFilter = periodo === 'mes'
            ? `TRUNC(:targetDate, 'MM')`
            : `TRUNC(:targetDate)`;

        const result = await connection.execute(
            `SELECT COUNT(DISTINCT cl.CODCLI) AS NOVOS_CLIENTES
             FROM PCCLIENT cl
             JOIN PCUSUARI U ON U.CODUSUR = cl.CODUSUR1
             JOIN PCNFSAID F ON F.CODCLI = cl.CODCLI
             JOIN PCMOV M ON M.NUMNOTA = F.NUMNOTA AND M.CODFILIAL = F.CODFILIAL AND M.CODUSUR = F.CODUSUR
             WHERE ${dateFilter}
             AND M.CODOPER = 'S'
             AND F.DTCANCEL IS NULL
             AND F.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             AND NOT EXISTS (
                 SELECT 1 FROM PCNFSAID F2
                 WHERE F2.CODCLI = cl.CODCLI
                 AND F2.DTCANCEL IS NULL
                 AND F2.CONDVENDA IN (1, 7, 9)
                 AND F2.DTSAIDA < ${subQueryFilter}
             )`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows[0].NOVOS_CLIENTES || 0;
    } catch (err) {
        logger.error(`Erro ao buscar novos clientes: ${err.message}`);
        return 0;
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca clientes reativados (compraram no período mas estavam inativos há 180+ dias)
 * @param {Date} targetDate
 * @param {string} periodo 'dia' ou 'mes'
 * @returns {Promise<number>}
 */
async function getReactivatedCustomers(targetDate = new Date(), periodo = 'dia') {
    let connection;
    try {
        connection = await getConnection();
        const dateFilter = periodo === 'mes'
            ? `F.DTSAIDA >= TRUNC(:targetDate, 'MM') AND F.DTSAIDA < TRUNC(:targetDate) + 1`
            : `F.DTSAIDA >= TRUNC(:targetDate) AND F.DTSAIDA < TRUNC(:targetDate) + 1`;

        const rangeFilter = periodo === 'mes'
            ? `TRUNC(:targetDate, 'MM')`
            : `TRUNC(:targetDate)`;
        
        const result = await connection.execute(
            `SELECT COUNT(DISTINCT F.CODCLI) AS REATIVADOS
             FROM PCNFSAID F
             JOIN PCCLIENT cl ON cl.CODCLI = F.CODCLI
             JOIN PCUSUARI U ON U.CODUSUR = F.CODUSUR
             WHERE ${dateFilter}
             AND F.DTCANCEL IS NULL
             AND F.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             AND NOT EXISTS (
                 SELECT 1 FROM PCNFSAID F2
                 WHERE F2.CODCLI = F.CODCLI
                 AND F2.DTCANCEL IS NULL
                 AND F2.CONDVENDA IN (1, 7, 9)
                 AND F2.DTSAIDA BETWEEN ${rangeFilter} - 90 AND ${rangeFilter} - 1
             )
             AND cl.DTCADASTRO < ${rangeFilter}
             AND EXISTS (
                 SELECT 1 FROM PCNFSAID F3
                 WHERE F3.CODCLI = F.CODCLI
                 AND F3.DTCANCEL IS NULL
                 AND F3.CONDVENDA IN (1, 7, 9)
                 AND F3.DTSAIDA < ${rangeFilter} - 90
             )`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows[0].REATIVADOS || 0;
    } catch (err) {
        logger.error(`Erro ao buscar clientes reativados: ${err.message}`);
        return 0;
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca positivação do dia e mês (clientes faturados com CONDVENDA correta vs base ativa de RCAs)
 * @param {Date} targetDate
 * @returns {Object}
 */
async function getPositivation(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        
        const pos = await connection.execute(
            `SELECT COUNT(DISTINCT F.CODCLI) AS CLIENTES_POSITIVADOS
             FROM PCNFSAID F
             JOIN PCUSUARI U ON U.CODUSUR = F.CODUSUR
             JOIN PCMOV M ON M.NUMNOTA = F.NUMNOTA AND M.CODFILIAL = F.CODFILIAL AND M.CODUSUR = F.CODUSUR
             WHERE F.DTSAIDA >= TRUNC(:targetDate)
             AND F.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND F.DTCANCEL IS NULL
             AND F.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        // QTD-CARTEIRA: Clientes vinculados a RCAs unblocked com meta no dia
        const total = await connection.execute(
            `SELECT COUNT(*) AS TOTAL_CLIENTES_ATIVOS 
             FROM PCCLIENT cl
             WHERE cl.CODUSUR1 IN (
                 SELECT DISTINCT M.CODUSUR 
                 FROM PCMETARCA M
                 JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
                 WHERE M.DATA = TRUNC(:targetDate)
                 AND U.BLOQUEIO = 'N'
             )`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Positivação do mês
        const posMes = await connection.execute(
            `SELECT COUNT(DISTINCT F.CODCLI) AS CLIENTES_POSITIVADOS_MES
             FROM PCNFSAID F
             JOIN PCUSUARI U ON U.CODUSUR = F.CODUSUR
             JOIN PCMOV M ON M.NUMNOTA = F.NUMNOTA AND M.CODFILIAL = F.CODFILIAL AND M.CODUSUR = F.CODUSUR
             WHERE F.DTSAIDA >= TRUNC(:targetDate, 'MM')
             AND F.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND F.DTCANCEL IS NULL
             AND F.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        return {
            CLIENTES_POSITIVADOS: pos.rows[0].CLIENTES_POSITIVADOS,
            TOTAL_CLIENTES_ATIVOS: total.rows[0].TOTAL_CLIENTES_ATIVOS,
            CLIENTES_POSITIVADOS_MES: posMes.rows[0].CLIENTES_POSITIVADOS_MES
        };
    } catch (err) {
        logger.error(`Erro ao buscar positivação: ${err.message}`);
        return { CLIENTES_POSITIVADOS: 0, TOTAL_CLIENTES_ATIVOS: 0, CLIENTES_POSITIVADOS_MES: 0 };
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca o mix de produtos total (soma do mix de produtos distintos por RCA)
 * @param {Date} targetDate
 * @param {string} period 'dia' ou 'mes'
 * @returns {Promise<number>}
 */
async function getMixTotal(targetDate = new Date(), period = 'dia') {
    let connection;
    try {
        connection = await getConnection();
        const dateFilter = period === 'mes'
            ? `M.DTMOV >= TRUNC(:targetDate, 'MM') AND M.DTMOV < TRUNC(:targetDate) + 1`
            : `M.DTMOV >= TRUNC(:targetDate) AND M.DTMOV < TRUNC(:targetDate) + 1`;
        
        const result = await connection.execute(
            `SELECT COUNT(DISTINCT M.CODPROD) AS TOTAL_MIX
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE ${dateFilter}
             AND M.CODOPER = 'S'
             AND U.BLOQUEIO = 'N'`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows[0].TOTAL_MIX || 0;
    } catch (err) {
        logger.error(`Erro ao buscar mix total (${period}): ${err.message}`);
        return 0;
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca vendas líquidas por filial hoje
 * @param {Date} targetDate
 * @returns {Array}
 */
async function getSalesByBranch(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        
        // Vendas brutas
        const salesResult = await connection.execute(
            `SELECT M.CODFILIAL, FI.RAZAOSOCIAL AS NOMEFILIAL,
                COUNT(DISTINCT M.NUMNOTA) AS PEDIDOS,
                NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_VENDAS_BRUTA,
                COUNT(DISTINCT M.CODCLI) AS CLIENTES
             FROM PCMOV M
             LEFT JOIN PCFILIAL FI ON FI.CODIGO = M.CODFILIAL
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             JOIN PCNFSAID N ON N.NUMNOTA = M.NUMNOTA AND N.CODFILIAL = M.CODFILIAL AND N.CODUSUR = M.CODUSUR
             WHERE N.DTSAIDA >= TRUNC(:targetDate)
             AND N.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND N.DTCANCEL IS NULL
             AND N.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             GROUP BY M.CODFILIAL, FI.RAZAOSOCIAL`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Devoluções
        const devolResult = await connection.execute(
            `SELECT M.CODFILIAL, NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS DEVOL_FILIAL
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DTMOV >= TRUNC(:targetDate)
             AND M.DTMOV < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'ED'
             AND U.BLOQUEIO = 'N'
             GROUP BY M.CODFILIAL`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const devolMap = {};
        devolResult.rows.forEach(r => {
            devolMap[String(r.CODFILIAL)] = r.DEVOL_FILIAL;
        });

        const rows = salesResult.rows.map(r => {
            const dev = devolMap[String(r.CODFILIAL)] || 0;
            return {
                CODFILIAL: r.CODFILIAL,
                NOMEFILIAL: formatFilialName(r.CODFILIAL, r.NOMEFILIAL),
                PEDIDOS: r.PEDIDOS,
                TOTAL_VENDAS: r.TOTAL_VENDAS_BRUTA - dev,
                CLIENTES: r.CLIENTES
            };
        }).sort((a, b) => b.TOTAL_VENDAS - a.TOTAL_VENDAS);

        return rows;
    } catch (err) {
        logger.error(`Erro ao buscar vendas por filial: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca vendas líquidas acumuladas do mês por filial
 * @param {Date} targetDate
 * @returns {Array}
 */
async function getSalesMonthByBranch(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        
        // Vendas brutas
        const salesResult = await connection.execute(
            `SELECT M.CODFILIAL, FI.RAZAOSOCIAL AS NOMEFILIAL,
                COUNT(DISTINCT M.NUMNOTA) AS PEDIDOS,
                NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_VENDAS_BRUTA,
                COUNT(DISTINCT M.CODCLI) AS CLIENTES
             FROM PCMOV M
             LEFT JOIN PCFILIAL FI ON FI.CODIGO = M.CODFILIAL
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             JOIN PCNFSAID N ON N.NUMNOTA = M.NUMNOTA AND N.CODFILIAL = M.CODFILIAL AND N.CODUSUR = M.CODUSUR
             WHERE N.DTSAIDA >= TRUNC(:targetDate, 'MM')
             AND N.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND N.DTCANCEL IS NULL
             AND N.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             GROUP BY M.CODFILIAL, FI.RAZAOSOCIAL`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Devoluções
        const devolResult = await connection.execute(
            `SELECT M.CODFILIAL, NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS DEVOL_FILIAL
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DTMOV >= TRUNC(:targetDate, 'MM')
             AND M.DTMOV < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'ED'
             AND U.BLOQUEIO = 'N'
             GROUP BY M.CODFILIAL`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const devolMap = {};
        devolResult.rows.forEach(r => {
            devolMap[String(r.CODFILIAL)] = r.DEVOL_FILIAL;
        });

        const rows = salesResult.rows.map(r => {
            const dev = devolMap[String(r.CODFILIAL)] || 0;
            return {
                CODFILIAL: r.CODFILIAL,
                NOMEFILIAL: formatFilialName(r.CODFILIAL, r.NOMEFILIAL),
                PEDIDOS: r.PEDIDOS,
                TOTAL_VENDAS: r.TOTAL_VENDAS_BRUTA - dev,
                CLIENTES: r.CLIENTES
            };
        }).sort((a, b) => b.TOTAL_VENDAS - a.TOTAL_VENDAS);

        return rows;
    } catch (err) {
        logger.error(`Erro ao buscar vendas do mês por filial: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca vendas líquidas dos últimos 5 dias para gráfico de tendência
 * @param {Date} targetDate
 * @returns {Array}
 */
async function getSalesLast5Days(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        
        // Vendas brutas
        const salesResult = await connection.execute(
            `SELECT 
                TRUNC(N.DTSAIDA) AS DIA,
                COUNT(DISTINCT M.NUMNOTA) AS PEDIDOS,
                NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS TOTAL_VENDAS_BRUTA,
                COUNT(DISTINCT M.CODCLI) AS CLIENTES
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             JOIN PCNFSAID N ON N.NUMNOTA = M.NUMNOTA AND N.CODFILIAL = M.CODFILIAL AND N.CODUSUR = M.CODUSUR
             WHERE N.DTSAIDA >= TRUNC(:targetDate) - 5
             AND N.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND N.DTCANCEL IS NULL
             AND N.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             GROUP BY TRUNC(N.DTSAIDA)
             ORDER BY TRUNC(N.DTSAIDA) ASC`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // Devoluções
        const devolResult = await connection.execute(
            `SELECT TRUNC(M.DTMOV) AS DIA, NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS DEVOL_DIA
             FROM PCMOV M
             JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
             WHERE M.DTMOV >= TRUNC(:targetDate) - 5
             AND M.DTMOV < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'ED'
             AND U.BLOQUEIO = 'N'
             GROUP BY TRUNC(M.DTMOV)`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const devolMap = {};
        devolResult.rows.forEach(r => {
            const dStr = new Date(r.DIA).toDateString();
            devolMap[dStr] = r.DEVOL_DIA;
        });

        const rows = salesResult.rows.map(r => {
            const dStr = new Date(r.DIA).toDateString();
            const dev = devolMap[dStr] || 0;
            const net = r.TOTAL_VENDAS_BRUTA - dev;
            return {
                DIA: r.DIA,
                PEDIDOS: r.PEDIDOS,
                TOTAL_VENDAS: net,
                TICKET_MEDIO: r.PEDIDOS > 0 ? (net / r.PEDIDOS) : 0,
                CLIENTES: r.CLIENTES
            };
        });

        return rows;
    } catch (err) {
        logger.error(`Erro ao buscar vendas últimos 5 dias: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca a lista detalhada de novos clientes cadastrados no dia
 * @param {Date} targetDate
 * @returns {Promise<Array>}
 */
async function getNewCustomersList(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT cl.CODCLI, cl.CLIENTE AS NOME_CLIENTE, cl.CODUSUR1 AS RCA, U.NOME AS NOME_RCA,
                    NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS VALOR_COMPRA
             FROM PCCLIENT cl
             JOIN PCUSUARI U ON U.CODUSUR = cl.CODUSUR1
             JOIN PCNFSAID F ON F.CODCLI = cl.CODCLI
             JOIN PCMOV M ON M.NUMNOTA = F.NUMNOTA AND M.CODFILIAL = F.CODFILIAL AND M.CODUSUR = F.CODUSUR
             WHERE F.DTSAIDA >= TRUNC(:targetDate)
               AND F.DTSAIDA < TRUNC(:targetDate) + 1
               AND M.CODOPER = 'S'
               AND F.DTCANCEL IS NULL
               AND F.CONDVENDA IN (1, 7, 9)
               AND U.BLOQUEIO = 'N'
               AND NOT EXISTS (
                   SELECT 1 FROM PCNFSAID F2
                   WHERE F2.CODCLI = cl.CODCLI
                   AND F2.DTCANCEL IS NULL
                   AND F2.CONDVENDA IN (1, 7, 9)
                   AND F2.DTSAIDA < TRUNC(:targetDate)
               )
             GROUP BY cl.CODCLI, cl.CLIENTE, cl.CODUSUR1, U.NOME
             ORDER BY VALOR_COMPRA DESC, cl.CODCLI`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows;
    } catch (err) {
        logger.error(`Erro ao buscar lista de novos clientes: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca a lista detalhada de clientes reativados no dia
 * @param {Date} targetDate
 * @returns {Promise<Array>}
 */
async function getReactivatedCustomersList(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT cl.CODCLI, cl.CLIENTE AS NOME_CLIENTE, F.CODUSUR AS RCA, U.NOME AS NOME_RCA,
                    NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS VALOR_COMPRA
             FROM PCNFSAID F
             JOIN PCCLIENT cl ON cl.CODCLI = F.CODCLI
             JOIN PCUSUARI U ON U.CODUSUR = F.CODUSUR
             JOIN PCMOV M ON M.NUMNOTA = F.NUMNOTA AND M.CODFILIAL = F.CODFILIAL AND M.CODUSUR = F.CODUSUR
             WHERE F.DTSAIDA >= TRUNC(:targetDate)
             AND F.DTSAIDA < TRUNC(:targetDate) + 1
             AND M.CODOPER = 'S'
             AND F.DTCANCEL IS NULL
             AND F.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             AND NOT EXISTS (
                 SELECT 1 FROM PCNFSAID F2
                 WHERE F2.CODCLI = F.CODCLI
                 AND F2.DTCANCEL IS NULL
                 AND F2.CONDVENDA IN (1, 7, 9)
                 AND F2.DTSAIDA BETWEEN TRUNC(:targetDate) - 90 AND TRUNC(:targetDate) - 1
             )
             AND cl.DTCADASTRO < TRUNC(:targetDate)
             AND EXISTS (
                 SELECT 1 FROM PCNFSAID F3
                 WHERE F3.CODCLI = F.CODCLI
                 AND F3.DTCANCEL IS NULL
                 AND F3.CONDVENDA IN (1, 7, 9)
                 AND F3.DTSAIDA < TRUNC(:targetDate) - 90
             )
             GROUP BY cl.CODCLI, cl.CLIENTE, F.CODUSUR, U.NOME
             ORDER BY VALOR_COMPRA DESC`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows;
    } catch (err) {
        logger.error(`Erro ao buscar lista de clientes reativados: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Busca o detalhamento de positivação, novos, reativados e faturamento por RCA
 * @param {Date} targetDate
 * @returns {Promise<Array>}
 */
async function getRcaBreakdownList(targetDate = new Date()) {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `WITH 
             RCAS AS (
                 SELECT DISTINCT M.CODUSUR, U.NOME
                 FROM PCMETARCA M
                 JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
                 WHERE M.DATA = TRUNC(:targetDate)
                 AND U.BLOQUEIO = 'N'
             ),
             CARTEIRA AS (
                 SELECT cl.CODUSUR1 AS CODUSUR, COUNT(*) AS QTY_CARTEIRA
                 FROM PCCLIENT cl
                 WHERE cl.BLOQUEIO IS NULL OR cl.BLOQUEIO = 'N'
                 GROUP BY cl.CODUSUR1
             ),
             VENDAS_HOJE AS (
                 SELECT M.CODUSUR, 
                        COUNT(DISTINCT M.CODCLI) AS QTY_POSITIVADOS,
                        NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS VALOR_BRUTO
                 FROM PCMOV M
                 JOIN PCNFSAID N ON N.NUMNOTA = M.NUMNOTA AND N.CODFILIAL = M.CODFILIAL AND N.CODUSUR = M.CODUSUR
                 WHERE N.DTSAIDA >= TRUNC(:targetDate)
                 AND N.DTSAIDA < TRUNC(:targetDate) + 1
                 AND M.CODOPER = 'S'
                 AND N.DTCANCEL IS NULL
                 AND N.CONDVENDA IN (1, 7, 9)
                 GROUP BY M.CODUSUR
             ),
             DEVOL_HOJE AS (
                 SELECT M.CODUSUR, 
                        NVL(SUM(M.QT * M.PUNIT + NVL(M.VLFRETE, 0)), 0) AS VALOR_DEVOL
                 FROM PCMOV M
                 WHERE M.DTMOV >= TRUNC(:targetDate)
                 AND M.DTMOV < TRUNC(:targetDate) + 1
                 AND M.CODOPER = 'ED'
                 GROUP BY M.CODUSUR
             ),
             NOVOS_HOJE AS (
                 SELECT cl.CODUSUR1 AS CODUSUR, COUNT(DISTINCT cl.CODCLI) AS QTY_NOVOS
                 FROM PCCLIENT cl
                 JOIN PCNFSAID F ON F.CODCLI = cl.CODCLI
                                AND F.DTSAIDA >= TRUNC(:targetDate)
                                AND F.DTSAIDA < TRUNC(:targetDate) + 1
                                AND F.DTCANCEL IS NULL
                                AND F.CONDVENDA IN (1, 7, 9)
                 WHERE NOT EXISTS (
                     SELECT 1 FROM PCNFSAID F2
                     WHERE F2.CODCLI = cl.CODCLI
                     AND F2.DTCANCEL IS NULL
                     AND F2.CONDVENDA IN (1, 7, 9)
                     AND F2.DTSAIDA < TRUNC(:targetDate)
                 )
                 GROUP BY cl.CODUSUR1
             ),
             REATIVADOS_HOJE AS (
                 SELECT F.CODUSUR, COUNT(DISTINCT F.CODCLI) AS QTY_REATIVADOS
                 FROM PCNFSAID F
                 JOIN PCCLIENT cl ON cl.CODCLI = F.CODCLI
                 WHERE F.DTSAIDA >= TRUNC(:targetDate)
                 AND F.DTSAIDA < TRUNC(:targetDate) + 1
                 AND F.DTCANCEL IS NULL
                 AND F.CONDVENDA IN (1, 7, 9)
                 AND NOT EXISTS (
                     SELECT 1 FROM PCNFSAID F2
                     WHERE F2.CODCLI = F.CODCLI
                     AND F2.DTCANCEL IS NULL
                     AND F2.CONDVENDA IN (1, 7, 9)
                     AND F2.DTSAIDA BETWEEN TRUNC(:targetDate) - 90 AND TRUNC(:targetDate) - 1
                 )
                 AND cl.DTCADASTRO < TRUNC(:targetDate)
                 AND EXISTS (
                     SELECT 1 FROM PCNFSAID F3
                     WHERE F3.CODCLI = F.CODCLI
                     AND F3.DTCANCEL IS NULL
                     AND F3.CONDVENDA IN (1, 7, 9)
                     AND F3.DTSAIDA < TRUNC(:targetDate) - 90
                 )
                 GROUP BY F.CODUSUR
             )
             SELECT 
                 R.CODUSUR,
                 R.NOME,
                 NVL(C.QTY_CARTEIRA, 0) AS CARTEIRA,
                 NVL(V.QTY_POSITIVADOS, 0) AS POSITIVADOS,
                 NVL(N.QTY_NOVOS, 0) AS NOVOS,
                 NVL(RE.QTY_REATIVADOS, 0) AS REATIVADOS,
                 NVL(V.VALOR_BRUTO, 0) - NVL(D.VALOR_DEVOL, 0) AS LIQUIDO
             FROM RCAS R
             LEFT JOIN CARTEIRA C ON C.CODUSUR = R.CODUSUR
             LEFT JOIN VENDAS_HOJE V ON V.CODUSUR = R.CODUSUR
             LEFT JOIN DEVOL_HOJE D ON D.CODUSUR = R.CODUSUR
             LEFT JOIN NOVOS_HOJE N ON N.CODUSUR = R.CODUSUR
             LEFT JOIN REATIVADOS_HOJE RE ON RE.CODUSUR = R.CODUSUR
             WHERE NVL(V.QTY_POSITIVADOS, 0) > 0 OR NVL(N.QTY_NOVOS, 0) > 0 OR NVL(RE.QTY_REATIVADOS, 0) > 0
             ORDER BY LIQUIDO DESC`,
            { targetDate }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        return result.rows;
    } catch (err) {
        logger.error(`Erro ao buscar detalhamento por RCA: ${err.message}`);
        return [];
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }
}

/**
 * Orquestra todas as consultas e retorna um objeto completo de dados de vendas
 * @returns {Object} Dados completos de vendas do dia
 */
async function getFullSalesReport(targetDate = new Date()) {
    // Garantir que targetDate seja um objeto Date válido e parseado no fuso horário local
    if (typeof targetDate === 'string') {
        const parts = targetDate.split(/[-/]/);
        if (parts.length === 3) {
            targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } else {
            targetDate = new Date(targetDate);
        }
    }
    logger.info(`📊 Buscando dados completos de vendas no Oracle para data: ${targetDate.toLocaleDateString('pt-BR')}...`);
    
    const [
        salesToday,
        salesMonth,
        monthlyTarget,
        dailyTarget,
        productMixDay,
        productMixMonth,
        newCustomersToday,
        newCustomersMonth,
        reactivatedToday,
        reactivatedMonth,
        positivation,
        salesByBranch,
        salesMonthByBranch,
        salesLast5Days,
        workingDaysInMonth,
        mixTotalDay,
        mixTotalMonth,
        newCustomersList,
        reactivatedList,
        rcaBreakdownList
    ] = await Promise.all([
        getSalesToday(targetDate),
        getSalesMonth(targetDate),
        getMonthlyTarget(targetDate),
        getDailyTarget(targetDate),
        getProductMix('dia', targetDate),
        getProductMix('mes', targetDate),
        getNewCustomers(targetDate, 'dia'),
        getNewCustomers(targetDate, 'mes'),
        getReactivatedCustomers(targetDate, 'dia'),
        getReactivatedCustomers(targetDate, 'mes'),
        getPositivation(targetDate),
        getSalesByBranch(targetDate),
        getSalesMonthByBranch(targetDate),
        getSalesLast5Days(targetDate),
        getWorkingDaysInMonth(targetDate),
        getMixTotal(targetDate, 'dia'),
        getMixTotal(targetDate, 'mes'),
        getNewCustomersList(targetDate),
        getReactivatedCustomersList(targetDate),
        getRcaBreakdownList(targetDate)
    ]);

    const report = {
        timestamp: new Date(),
        targetDate: targetDate,
        dia: {
            vendas: salesToday.TOTAL_VENDAS, 
            vendasBruta: salesToday.TOTAL_VENDAS_BRUTA,
            devolucoes: salesToday.TOTAL_DEVOLUCOES,
            pedidos: salesToday.TOTAL_PEDIDOS,
            ticketMedio: salesToday.TICKET_MEDIO,
            clientesAtendidos: salesToday.CLIENTES_ATENDIDOS,
            vendedoresAtivos: salesToday.VENDEDORES_ATIVOS,
            filiaisAtivas: salesToday.FILIAIS_ATIVAS,
            mixTotal: mixTotalDay
        },
        meta: {
            metaMes: monthlyTarget.total.META_TOTAL,
            metaDia: dailyTarget.META_DIA,
            metaCliPos: monthlyTarget.total.META_CLI_POS,
            metaMix: monthlyTarget.total.META_MIX,
            metaNovos: dailyTarget.META_NOVOS,
            metaReativados: dailyTarget.META_REATIVADOS,
            vendedores: monthlyTarget.total.VENDEDORES,
            porFilial: monthlyTarget.porFilial
        },
        mes: {
            vendas: salesMonth.TOTAL_VENDAS_MES, 
            vendasBruta: salesMonth.TOTAL_VENDAS_BRUTA_MES,
            devolucoes: salesMonth.TOTAL_DEVOLUCOES_MES,
            pedidos: salesMonth.TOTAL_PEDIDOS,
            ticketMedio: salesMonth.TICKET_MEDIO_MES,
            clientes: salesMonth.CLIENTES_MES,
            diasUteis: workingDaysInMonth,
            mixTotal: mixTotalMonth,
            novosClientes: newCustomersMonth,
            reativados: reactivatedMonth
        },
        mixProdutosDia: productMixDay,
        mixProdutosMes: productMixMonth,
        novosClientes: newCustomersToday,
        reativados: reactivatedToday,
        positivacao: {
            hoje: positivation.CLIENTES_POSITIVADOS,
            mes: positivation.CLIENTES_POSITIVADOS_MES,
            baseAtiva: positivation.TOTAL_CLIENTES_ATIVOS
        },
        vendasPorFilialDia: salesByBranch,
        vendasPorFilialMes: salesMonthByBranch,
        vendasUltimos5Dias: salesLast5Days,
        novosClientesDetalhes: newCustomersList,
        reativadosDetalhes: reactivatedList,
        positivacaoDetalhes: rcaBreakdownList
    };

    logger.info(`📊 Dados coletados para ${targetDate.toLocaleDateString('pt-BR')}: R$ ${report.dia.vendas.toFixed(2)} dia (Líq) | R$ ${report.mes.vendas.toFixed(2)} mês (Líq) | Meta: R$ ${report.meta.metaMes.toFixed(2)} | Dias Úteis: ${workingDaysInMonth}`);
    return report;
}

module.exports = {
    getSalesToday,
    getSalesMonth,
    getMonthlyTarget,
    getDailyTarget,
    getWorkingDaysInMonth,
    getProductMix,
    getNewCustomers,
    getReactivatedCustomers,
    getPositivation,
    getMixTotal,
    getSalesByBranch,
    getSalesMonthByBranch,
    getSalesLast5Days,
    getFullSalesReport
};
