const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');

const EXCEL_PATH = path.join(__dirname, '..', '..', 'data', 'deposito_bloqueados_avarias.xlsx');

/**
 * Busca itens parados no depósito (bloqueados e/ou avariados) por filial.
 * Filiais 20 e 6 são consolidadas em '20 + 6' (estoques somados, endereço da 20).
 * Endereçamento WMS (Rua/Prédio/Apto/Módulo) vem da PCEST, como no relatório
 * de inteligência logística.
 *
 * @param {string} filialCode '20 + 6' (ou '20'/'6'), '21', '22', '23'
 * @returns {Promise<Array>} Itens com quantidades, valores, datas e endereço
 */
async function getBlockedStockData(filialCode = '20 + 6') {
    const isGroup20_6 = filialCode === '20 + 6' || filialCode === '20' || filialCode === '6';
    const filialGroupParam = isGroup20_6 ? '20_6' : 'SINGLE';
    const filialParam = isGroup20_6 ? '20' : String(filialCode);

    const query = `
    SELECT
        E.CODPROD,
        P.DESCRICAO,
        P.EMBALAGEM,
        P.UNIDADE,
        P.CODFORNEC,
        FORN.FANTASIA AS FORNECEDOR,
        SUM(NVL(E.QTBLOQUEADA, 0)) AS QT_BLOQUEADA,
        SUM(NVL(E.QTINDENIZ, 0)) AS QT_AVARIA,
        SUM(NVL(E.QTESTGER, 0)) AS QT_ESTOQUE_GERAL,
        SUM(GREATEST(NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0) - NVL(E.QTBLOQUEADA,0) - NVL(E.QTINDENIZ,0), 0)) AS QT_DISPONIVEL,
        -- Valor parado a custo real (bloqueado + avaria)
        ROUND(SUM((NVL(E.QTBLOQUEADA,0) + NVL(E.QTINDENIZ,0)) * NVL(E.CUSTOREAL, 0)), 2) AS VALOR_PARADO,
        MAX(E.DTULTENT) AS DT_ULT_ENTRADA,
        MAX(E.DTULTSAIDA) AS DT_ULT_SAIDA,
        -- Endereço WMS: prioriza a filial 20 no grupo 20+6 (como na inteligência logística)
        NVL(MIN(CASE WHEN E.CODFILIAL = :filialParam THEN E.RUA    END), MIN(E.RUA))    AS RUA,
        NVL(MIN(CASE WHEN E.CODFILIAL = :filialParam THEN E.NUMERO END), MIN(E.NUMERO)) AS PREDIO,
        NVL(MIN(CASE WHEN E.CODFILIAL = :filialParam THEN E.APTO   END), MIN(E.APTO))   AS APARTAMENTO,
        NVL(MIN(CASE WHEN E.CODFILIAL = :filialParam THEN E.MODULO END), MIN(E.MODULO)) AS MODULO,
        -- Demanda pendente (pedidos de venda posição P/B) na mesma filial/grupo
        (
          SELECT NVL(SUM(NVL(I.QT, 0)), 0)
          FROM PCPEDI I
          WHERE I.CODPROD = E.CODPROD
            AND I.POSICAO IN ('P', 'B')
            AND (
              (:filialGroupParam = '20_6' AND I.CODFILIALRETIRA IN ('20', '6'))
              OR
              (:filialGroupParam = 'SINGLE' AND I.CODFILIALRETIRA = :filialParam)
            )
        ) AS QT_PEDIDOS_PENDENTES
    FROM PCEST E
    JOIN PCPRODUT P ON P.CODPROD = E.CODPROD
    LEFT JOIN PCFORNEC FORN ON FORN.CODFORNEC = P.CODFORNEC
    WHERE (NVL(E.QTBLOQUEADA, 0) > 0 OR NVL(E.QTINDENIZ, 0) > 0)
      AND (
        (:filialGroupParam = '20_6' AND E.CODFILIAL IN ('20', '6'))
        OR
        (:filialGroupParam = 'SINGLE' AND E.CODFILIAL = :filialParam)
      )
    GROUP BY E.CODPROD, P.DESCRICAO, P.EMBALAGEM, P.UNIDADE, P.CODFORNEC, FORN.FANTASIA
    ORDER BY VALOR_PARADO DESC, P.DESCRICAO
    `;

    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(query, { filialGroupParam, filialParam }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const now = new Date();
        const days = (d) => d ? Math.floor((now - new Date(d)) / 86400000) : null;

        return (result.rows || []).map(r => {
            const qtBloq = Number(r.QT_BLOQUEADA) || 0;
            const qtAvaria = Number(r.QT_AVARIA) || 0;
            const pend = Number(r.QT_PEDIDOS_PENDENTES) || 0;
            const diasEntrada = days(r.DT_ULT_ENTRADA);
            const diasSaida = days(r.DT_ULT_SAIDA);

            let situacao;
            if (qtBloq > 0 && qtAvaria > 0) situacao = 'BLOQ + AVARIA';
            else if (qtAvaria > 0) situacao = 'AVARIA';
            else situacao = 'BLOQUEADO';

            // Sugestão do analista para orientar a decisão do gestor
            let sugestao;
            if (qtAvaria > 0) {
                sugestao = 'Avaliar descarte/indenização (avaria)';
            } else if (diasEntrada !== null && diasEntrada <= 2) {
                sugestao = pend > 0
                    ? 'Entrada recente — priorizar liberação (tem demanda)'
                    : 'Entrada recente — conferência em andamento';
            } else if (pend > 0) {
                sugestao = `Avaliar desbloqueio — ${pend.toLocaleString('pt-BR')} un. em pedidos pendentes`;
            } else if (diasSaida !== null && diasSaida > 60) {
                sugestao = `Sem saída há ${diasSaida}d — avaliar desbloqueio ou descarte`;
            } else {
                sugestao = 'Analisar motivo do bloqueio';
            }

            return {
                CODPROD: r.CODPROD,
                DESCRICAO: `${r.DESCRICAO || ''}${r.EMBALAGEM ? ' (' + r.EMBALAGEM + (r.UNIDADE ? ' ' + r.UNIDADE : '') + ')' : ''}`,
                FORNECEDOR: r.FORNECEDOR || 'NÃO IDENTIFICADO',
                RUA: r.RUA !== null && r.RUA !== undefined ? String(r.RUA) : '—',
                PREDIO: r.PREDIO !== null && r.PREDIO !== undefined ? String(r.PREDIO) : '—',
                APARTAMENTO: r.APARTAMENTO !== null && r.APARTAMENTO !== undefined ? String(r.APARTAMENTO) : '—',
                MODULO: r.MODULO !== null && r.MODULO !== undefined ? String(r.MODULO) : '—',
                SITUACAO: situacao,
                QT_BLOQUEADA: qtBloq,
                QT_AVARIA: qtAvaria,
                QT_DISPONIVEL: Number(r.QT_DISPONIVEL) || 0,
                QT_PEDIDOS_PENDENTES: pend,
                VALOR_PARADO: Number(r.VALOR_PARADO) || 0,
                DT_ULT_ENTRADA: r.DT_ULT_ENTRADA ? new Date(r.DT_ULT_ENTRADA) : null,
                DT_ULT_SAIDA: r.DT_ULT_SAIDA ? new Date(r.DT_ULT_SAIDA) : null,
                DIAS_SEM_SAIDA: diasSaida,
                SUGESTAO: sugestao
            };
        });
    } finally {
        if (connection) { try { await connection.close(); } catch (e) {} }
    }
}

const THIN = { style: 'thin', color: { argb: 'CBD5E1' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * Gera o Excel do raio-x de itens parados (bloqueados/avariados) do depósito.
 * @param {Array} rows Saída de getBlockedStockData
 * @param {string} filialLabel Rótulo da filial no título (ex.: 'BRAGO BRASÍLIA (20+6)')
 * @param {string} [outPath]
 * @returns {Promise<string>} Caminho do arquivo
 */
async function generateBlockedStockExcel(rows, filialLabel = 'BRAGO BRASÍLIA (20+6)', outPath = EXCEL_PATH) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Brago App System';
    wb.created = new Date();
    const ws = wb.addWorksheet('Itens Parados', { views: [{ state: 'frozen', ySplit: 4 }] });

    const COLS = [
        { key: 'CODPROD',              header: 'Cód Prod.',        width: 10, align: 'center' },
        { key: 'DESCRICAO',            header: 'Descrição',        width: 42, align: 'left' },
        { key: 'FORNECEDOR',           header: 'Fornecedor',       width: 24, align: 'left' },
        { key: 'RUA',                  header: 'Rua',              width: 7,  align: 'center' },
        { key: 'PREDIO',               header: 'Prédio',           width: 8,  align: 'center' },
        { key: 'APARTAMENTO',          header: 'Apto',             width: 7,  align: 'center' },
        { key: 'MODULO',               header: 'Módulo',           width: 8,  align: 'center' },
        { key: 'SITUACAO',             header: 'Situação',         width: 15, align: 'center' },
        { key: 'QT_BLOQUEADA',         header: 'Qt Bloq.',         width: 10, align: 'right' },
        { key: 'QT_AVARIA',            header: 'Qt Avaria',        width: 10, align: 'right' },
        { key: 'QT_DISPONIVEL',        header: 'Qt Disp.',         width: 10, align: 'right' },
        { key: 'QT_PEDIDOS_PENDENTES', header: 'Ped. Pend.',       width: 10, align: 'right' },
        { key: 'VALOR_PARADO',         header: 'Valor Parado R$',  width: 15, align: 'right' },
        { key: 'DT_ULT_ENTRADA',       header: 'Últ. Entrada',     width: 12, align: 'center' },
        { key: 'DT_ULT_SAIDA',         header: 'Últ. Saída',       width: 12, align: 'center' },
        { key: 'DIAS_SEM_SAIDA',       header: 'Dias s/ Saída',    width: 11, align: 'right' },
        { key: 'SUGESTAO',             header: 'Sugestão de Ação', width: 44, align: 'left' }
    ];
    ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));
    const lastCol = ws.getColumn(COLS.length).letter;

    // Título
    ws.mergeCells(`A1:${lastCol}1`);
    const dataStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const title = ws.getCell('A1');
    title.value = `RAIO-X DO DEPÓSITO — ITENS BLOQUEADOS / AVARIADOS — ${filialLabel} — ${dataStr}`;
    title.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    title.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 28;

    // KPIs
    const totBloq = rows.reduce((s, r) => s + r.QT_BLOQUEADA, 0);
    const totAvaria = rows.reduce((s, r) => s + r.QT_AVARIA, 0);
    const totValor = rows.reduce((s, r) => s + r.VALOR_PARADO, 0);
    const nAvaria = rows.filter(r => r.QT_AVARIA > 0).length;
    ws.mergeCells(`A2:${lastCol}2`);
    const kpi = ws.getCell('A2');
    kpi.value = `${rows.length} produtos parados   |   Qt bloqueada: ${Math.round(totBloq).toLocaleString('pt-BR')} un.   |   Qt avaria: ${Math.round(totAvaria).toLocaleString('pt-BR')} un. (${nAvaria} produtos)   |   Valor parado: R$ ${totValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    kpi.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: '1E293B' } };
    kpi.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };
    kpi.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 22;

    // Nota metodológica curta (linha 3)
    ws.mergeCells(`A3:${lastCol}3`);
    const note = ws.getCell('A3');
    note.value = 'Ordenado por valor parado (custo real). Endereçamento WMS (Rua/Prédio/Apto/Módulo). "Ped. Pend." = unidades em pedidos de venda aguardando — indício de que vale desbloquear.';
    note.font = { name: 'Calibri', size: 9, italic: true, color: { argb: '475569' } };
    note.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(3).height = 16;

    // Cabeçalho
    const headerRow = ws.getRow(4);
    COLS.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = c.header;
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER;
    });
    headerRow.height = 24;

    rows.forEach((r, idx) => {
        const row = ws.addRow(r);
        row.height = 18;
        const bg = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
        row.eachCell((cell, ci) => {
            const c = COLS[ci - 1];
            cell.border = BORDER;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: c.key === 'SUGESTAO' };
            cell.font = { name: 'Calibri', size: 9.5, color: { argb: '1E293B' } };

            if (c.key === 'SITUACAO') {
                if (r.SITUACAO === 'AVARIA' || r.SITUACAO === 'BLOQ + AVARIA') {
                    cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'B91C1C' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
                } else {
                    cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: '1E3A8A' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
                }
            } else if (['QT_BLOQUEADA', 'QT_AVARIA', 'QT_DISPONIVEL', 'QT_PEDIDOS_PENDENTES'].includes(c.key)) {
                cell.numFmt = '#,##0.##';
                if (c.key === 'QT_AVARIA' && r.QT_AVARIA > 0) cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'B91C1C' } };
                if (c.key === 'QT_PEDIDOS_PENDENTES' && r.QT_PEDIDOS_PENDENTES > 0) cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: '2563EB' } };
            } else if (c.key === 'VALOR_PARADO') {
                cell.numFmt = '#,##0.00';
                cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: '0F172A' } };
            } else if (c.key === 'DT_ULT_ENTRADA' || c.key === 'DT_ULT_SAIDA') {
                if (cell.value) cell.numFmt = 'dd/mm/yyyy';
                else { cell.value = '—'; }
            } else if (c.key === 'DIAS_SEM_SAIDA') {
                if (cell.value === null || cell.value === undefined) cell.value = '—';
                else if (r.DIAS_SEM_SAIDA > 60) cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'B91C1C' } };
            } else if (c.key === 'SUGESTAO') {
                cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: r.QT_AVARIA > 0 ? 'B91C1C' : '334155' } };
            }
        });
    });

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLS.length } };

    await wb.xlsx.writeFile(outPath);
    logger.info(`✅ Planilha de itens parados do depósito gerada: ${outPath} (${rows.length} produtos)`);
    return outPath;
}

/**
 * Executa o relatório de itens parados (bloqueados/avariados) e envia por WhatsApp.
 * 
 * @param {string} filial '20 + 6', '21', '22', '23'
 * @param {Array<string>} [targetNumbers] Números específicos para envio (opcional)
 * @returns {Promise<Object>} Resumo da execução
 */
async function runBlockedReport(filial = '20 + 6', targetNumbers = null) {
    try {
        const configManager = require('../utils/configManager');
        const whatsapp = require('./whatsappService');
        const settings = configManager.getSettings();
        
        let numbers = targetNumbers;
        if (!numbers || numbers.length === 0) {
            numbers = (settings.logisticsNotifyNumbers && settings.logisticsNotifyNumbers[filial]) || [];
            if (numbers.length === 0) {
                numbers = ['5562996101684']; // Brenan Marketing fallback
            }
        }

        logger.info(`[Deposito Bloqueados] Gerando relatório para a filial ${filial}...`);
        const rows = await getBlockedStockData(filial);
        
        if (rows.length === 0) {
            logger.info(`[Deposito Bloqueados] Nenhum item parado encontrado para a filial ${filial}.`);
            return { success: true, message: 'Nenhum item parado encontrado.' };
        }

        const filialLabel = filial === '20 + 6' ? 'BRAGO BRASÍLIA (20+6)' : `FILIAL ${filial}`;
        const timestamp = Date.now();
        const tempExcelPath = path.join(__dirname, '..', '..', 'data', `deposito_bloqueados_avarias_${filial.replace(/\s+/g, '')}_${timestamp}.xlsx`);
        const filePath = await generateBlockedStockExcel(rows, filialLabel, tempExcelPath);

        const totBloq = rows.reduce((s, r) => s + r.QT_BLOQUEADA, 0);
        const totAvaria = rows.reduce((s, r) => s + r.QT_AVARIA, 0);
        const totValor = rows.reduce((s, r) => s + r.VALOR_PARADO, 0);
        
        const caption = `📋 *Raio-X do Depósito — Itens Parados (Bloqueados / Avariados)*\n` +
            `📍 *Filial:* ${filialLabel}\n` +
            `📦 *Produtos Parados:* ${rows.length}\n` +
            `🔒 *Qt. Bloqueada:* ${Math.round(totBloq).toLocaleString('pt-BR')} un.\n` +
            `💥 *Qt. Avaria:* ${Math.round(totAvaria).toLocaleString('pt-BR')} un.\n` +
            `💰 *Valor Total Parado:* R$ ${totValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
            `_Planilha em anexo contendo os endereços WMS e sugestões de ação para tomada de decisão do gestor do depósito._`;

        logger.info(`[Deposito Bloqueados] Enviando relatório para ${numbers.join(', ')}...`);
        for (const num of numbers) {
            try {
                await whatsapp.sendFileToNumber(num, filePath, caption);
            } catch (sendErr) {
                logger.error(`[Deposito Bloqueados] Erro ao enviar para ${num}: ${sendErr.message}`);
            }
        }

        // Limpa arquivo temporário
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            logger.warn(`[Deposito Bloqueados] Erro ao limpar arquivo temporário ${filePath}: ${e.message}`);
        }

        return { success: true, count: rows.length, numbers };
    } catch (err) {
        logger.error(`[Deposito Bloqueados] Erro ao executar relatório para a filial ${filial}: ${err.message}`);
        throw err;
    }
}

let blockedJob = null;

/**
 * Inicializa o agendamento do relatório de itens parados no depósito
 */
function initScheduler() {
    try {
        const { CronJob } = require('cron');
        const configManager = require('../utils/configManager');
        const settings = configManager.getSettings();
        
        // Toda Segunda-feira às 08:30 da manhã
        blockedJob = new CronJob('30 08 * * 1', async () => {
            try {
                await runBlockedReport('20 + 6');
            } catch (err) {
                logger.error(`[Deposito Bloqueados] Falha na execução agendada de segunda-feira: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');
        blockedJob.start();
        logger.info('🚀 Cron job de itens bloqueados do depósito (Segunda-Feira 08:30) inicializado com sucesso.');
    } catch (e) {
        logger.error(`[Deposito Bloqueados] Erro ao inicializar scheduler: ${e.message}`);
    }
}

module.exports = { 
    getBlockedStockData, 
    generateBlockedStockExcel,
    runBlockedReport,
    initScheduler
};
