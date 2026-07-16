const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const EXCEL_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Gera um arquivo Excel estruturado com as informações de Inteligência Logística da filial
 * 
 * @param {Object} logisticsData Dados retornados pelo logisticsOracleService
 * @returns {Promise<string>} Caminho do arquivo Excel gerado
 */
async function generateLogisticsExcel(logisticsData, transfers = []) {
    const { filialCode, kpis, cronograma, topFornecedores, weekItems, allItems } = logisticsData;
    
    // Normalizar o nome do arquivo conforme a filial
    const filialSafeName = filialCode.replace(/\s+/g, '').replace('+', '_');
    const fileName = `inteligencia_logistica_${filialSafeName}.xlsx`;
    const filePath = path.join(EXCEL_DIR, fileName);

    try {
        if (!fs.existsSync(EXCEL_DIR)) {
            fs.mkdirSync(EXCEL_DIR, { recursive: true });
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Brago App System';
        workbook.lastModifiedBy = 'Brago App System';
        workbook.created = new Date();
        workbook.modified = new Date();

        // ----------------------------------------------------
        // ABA 1: RESUMO EXECUTIVO (KPIs)
        // ----------------------------------------------------
        const wsDashboard = workbook.addWorksheet('Resumo Executivo');
        wsDashboard.views = [{ showGridLines: true }];
        buildDashboardTab(wsDashboard, logisticsData);

        // ----------------------------------------------------
        // ABA 2: PREVISÃO DA SEMANA
        // ----------------------------------------------------
        const wsSemana = workbook.addWorksheet('Previsão da Semana');
        wsSemana.views = [{ showGridLines: true }];
        buildDetailsTab(wsSemana, weekItems, 'Previsão da Semana - Filial ' + filialCode);

        // ----------------------------------------------------
        // ABA 3: PREVISÃO GERAL
        // ----------------------------------------------------
        const wsCarteira = workbook.addWorksheet('Previsão Geral');
        wsCarteira.views = [{ showGridLines: true }];
        buildDetailsTab(wsCarteira, allItems, 'Previsão Geral - Filial ' + filialCode);

        // ----------------------------------------------------
        // ABA 4: TRANSFERÊNCIAS EM TRÂNSITO (quando existirem)
        // ----------------------------------------------------
        if (transfers && transfers.length > 0) {
            const wsTransf = workbook.addWorksheet('Transferências em Trânsito');
            wsTransf.views = [{ showGridLines: true }];
            buildTransfersTab(wsTransf, transfers, filialCode);
        }

        await workbook.xlsx.writeFile(filePath);
        logger.info(`✅ Planilha Excel de Inteligência Logística gerada em: ${filePath}`);
        return filePath;

    } catch (err) {
        logger.error(`❌ Erro ao gerar planilha Excel logístico: ${err.message}`);
        throw err;
    }
}

/**
 * Constrói a aba de Resumo Executivo (Dashboard)
 */
function buildDashboardTab(ws, data) {
    const { filialCode, kpis, cronograma, topFornecedores, weekItems, startOfWeek, endOfWeek } = data;

    // Fallback para datas da semana corrente se não fornecidas
    let sOfWeek = startOfWeek;
    let eOfWeek = endOfWeek;
    if (!sOfWeek || !eOfWeek) {
        const now = new Date();
        const day = now.getDay();
        const diffToMon = day === 0 ? -6 : 1 - day;
        sOfWeek = new Date(now);
        sOfWeek.setDate(now.getDate() + diffToMon);
        sOfWeek.setHours(0, 0, 0, 0);

        eOfWeek = new Date(sOfWeek);
        eOfWeek.setDate(sOfWeek.getDate() + 4); // Sexta-Feira
        eOfWeek.setHours(23, 59, 59, 999);
    }

    // Definição de colunas
    ws.columns = [
        { width: 4 },   // A (Espaçador)
        { width: 16 },  // B (Dia da Semana - Seg 22/06)
        { width: 40 },  // C (Fornecedores - list of comma-separated names)
        { width: 16 },  // D (QTD ITENS)
        { width: 16 },  // E (QTD CAIXAS)
        { width: 22 },  // F (VOLUME DE ITENS M3)
        { width: 18 },  // G
        { width: 18 }   // H
    ];

    // Estilos padrão
    const fontTitle = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
    const fontSection = { name: 'Calibri', size: 11, bold: true, color: { argb: '0F172A' } };
    const fontHeader = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFF' } };
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'CBD5E1' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } }
    };

    // 1. Título do Relatório (merging B a H)
    ws.mergeCells('B2:H2');
    const titleCell = ws.getCell('B2');
    titleCell.value = `INTELIGÊNCIA LOGÍSTICA — FILIAL ${filialCode}`;
    titleCell.font = fontTitle;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 36;

    // 2. KPI Cards
    // Card 1: Pedidos da Semana
    ws.mergeCells('B4:B5');
    const card1 = ws.getCell('B4');
    card1.value = `QTD Fornec a Chegar\n\n${kpis.totalPedidosSemana} pedidos`;
    card1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '1E3A8A' } };
    card1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    card1.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    card1.border = thinBorder;

    // Card 2: Volume total de itens em M3
    ws.mergeCells('C4:C5');
    const card2 = ws.getCell('C4');
    card2.value = `VOLUME DE ITENS\n\n${kpis.totalVolumeSemana.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³`;
    card2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '0F172A' } };
    card2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    card2.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    card2.border = thinBorder;

    // Card 3: Urgência Recebimento (Estoque Zero)
    ws.mergeCells('D4:D5');
    const card3 = ws.getCell('D4');
    card3.value = `PRODUTOS COM ESTOQUE ZERADO\n\n${kpis.totalUrgentes} itens`;
    card3.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'B91C1C' } };
    card3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
    card3.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    card3.border = thinBorder;

    // Card 4: Sem Endereço 99 ou 0
    ws.mergeCells('E4:E5');
    const card4 = ws.getCell('E4');
    card4.value = `SEM ENDEREÇO 99 OU 0\n\n${kpis.totalSemEndereco} itens`;
    card4.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '92400E' } };
    card4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBEB' } };
    card4.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    card4.border = thinBorder;

    // Card 5: Previsão da Semana
    ws.mergeCells('F4:H5');
    const card5 = ws.getCell('F4');
    
    const formatLabel = (d) => {
        const dayStr = String(d.getDate()).padStart(2, '0');
        const monthStr = String(d.getMonth() + 1).padStart(2, '0');
        return `${dayStr}/${monthStr}`;
    };
    
    card5.value = `PRAZO ATUAL DE PREVISÃO\n\nSemana ${formatLabel(sOfWeek)} a ${formatLabel(eOfWeek)}`;
    card5.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '475569' } };
    card5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    card5.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    card5.border = thinBorder;

    ws.getRow(4).height = 24;
    ws.getRow(5).height = 24;

    // 3. Cronograma de Recebimento
    ws.mergeCells('B7:F7');
    const titleCron = ws.getCell('B7');
    titleCron.value = 'CRONOGRAMA DIÁRIO DE RECEBIMENTO';
    titleCron.font = fontSection;
    ws.getRow(7).height = 20;

    const cronHeaders = ['DIA DA SEMANA', 'FORNECEDORES', 'QTD ITENS', 'QTD CAIXAS', 'VOLUME DE ITENS M3'];
    cronHeaders.forEach((h, idx) => {
        const col = String.fromCharCode(66 + idx); // B, C, D, E, F
        const cell = ws.getCell(`${col}8`);
        cell.value = h;
        cell.font = fontHeader;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
        // Alinhamento: B e C -> esquerda, D, E e F -> direita
        cell.alignment = { vertical: 'middle', horizontal: idx <= 1 ? 'left' : 'right' };
        cell.border = thinBorder;
    });
    ws.getRow(8).height = 18;

    const dayMappings = {
        'Segunda-Feira': { abbrev: 'Seg', offset: 0 },
        'Terça-Feira': { abbrev: 'Ter', offset: 1 },
        'Quarta-Feira': { abbrev: 'Qua', offset: 2 },
        'Quinta-Feira': { abbrev: 'Qui', offset: 3 },
        'Sexta-Feira': { abbrev: 'Sex', offset: 4 }
    };

    let rowIdx = 9;
    cronograma.forEach(row => {
        const dia = row.dia;
        const mapping = dayMappings[dia];
        
        let diaLabel = dia;
        if (mapping) {
            const dateOfSlot = new Date(sOfWeek);
            dateOfSlot.setDate(sOfWeek.getDate() + mapping.offset);
            const dStr = String(dateOfSlot.getDate()).padStart(2, '0');
            const mStr = String(dateOfSlot.getMonth() + 1).padStart(2, '0');
            diaLabel = `${mapping.abbrev} ${dStr}/${mStr}`;
            if (row.isSubtotal) {
                diaLabel = `Total ${diaLabel}`;
            }
        }
        
        const cellDia = ws.getCell(`B${rowIdx}`);
        cellDia.value = diaLabel;
        cellDia.font = { name: 'Calibri', size: 9, bold: !!row.isSubtotal };
        cellDia.border = thinBorder;
        if (row.isSubtotal) {
            cellDia.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        }

        const cellForn = ws.getCell(`C${rowIdx}`);
        cellForn.value = row.fornecedor;
        cellForn.font = { name: 'Calibri', size: 9, bold: !!row.isSubtotal };
        cellForn.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        cellForn.border = thinBorder;
        if (row.isSubtotal) {
            cellForn.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        }

        const hasData = row.itens > 0 || row.caixas > 0 || row.volumeM3 > 0;

        // D: QTD ITENS
        const cellItens = ws.getCell(`D${rowIdx}`);
        cellItens.value = hasData ? (row.itens || 0) : '—';
        cellItens.font = { name: 'Calibri', size: 9, bold: !!row.isSubtotal };
        cellItens.alignment = { horizontal: 'right', vertical: 'middle' };
        if (hasData) {
            cellItens.numFormat = '#,##0';
        }
        cellItens.border = thinBorder;
        if (row.isSubtotal) {
            cellItens.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        }

        // E: QTD CAIXAS
        const cellCaixas = ws.getCell(`E${rowIdx}`);
        cellCaixas.value = hasData ? Math.round(row.caixas || 0) : '—';
        cellCaixas.font = { name: 'Calibri', size: 9, bold: !!row.isSubtotal };
        cellCaixas.alignment = { horizontal: 'right', vertical: 'middle' };
        if (hasData) {
            cellCaixas.numFormat = '#,##0';
        }
        cellCaixas.border = thinBorder;
        if (row.isSubtotal) {
            cellCaixas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        }

        // F: VOLUME DE ITENS M3
        const cellVol = ws.getCell(`F${rowIdx}`);
        cellVol.value = hasData ? (row.volumeM3 || 0) : '—';
        cellVol.font = { name: 'Calibri', size: 9, bold: !!row.isSubtotal };
        cellVol.alignment = { horizontal: 'right', vertical: 'middle' };
        if (hasData) {
            cellVol.numFormat = '#,##0.000';
        }
        cellVol.border = thinBorder;
        if (row.isSubtotal) {
            cellVol.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        }

        ws.getRow(rowIdx).height = row.isSubtotal ? 22 : 20;
        rowIdx++;
    });

    // Linha de Soma/Total Geral
    const cellTotalLabel = ws.getCell(`B${rowIdx}`);
    cellTotalLabel.value = 'Total Geral';
    cellTotalLabel.font = { name: 'Calibri', size: 9, bold: true };
    cellTotalLabel.border = thinBorder;
    cellTotalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

    const cellTotalForn = ws.getCell(`C${rowIdx}`);
    const uniqueForns = new Set(cronograma.filter(r => !r.isSubtotal && r.fornecedor && r.fornecedor !== '—').map(r => r.fornecedor)).size;
    cellTotalForn.value = `${uniqueForns} fornecedores`;
    cellTotalForn.font = { name: 'Calibri', size: 9, bold: true };
    cellTotalForn.alignment = { horizontal: 'left', vertical: 'middle' };
    cellTotalForn.border = thinBorder;
    cellTotalForn.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

    const sumItens = cronograma.filter(r => !r.isSubtotal).reduce((acc, r) => acc + r.itens, 0);
    const sumCaixas = cronograma.filter(r => !r.isSubtotal).reduce((acc, r) => acc + r.caixas, 0);
    const sumVol = cronograma.filter(r => !r.isSubtotal).reduce((acc, r) => acc + r.volumeM3, 0);

    const cellTotalItens = ws.getCell(`D${rowIdx}`);
    cellTotalItens.value = sumItens > 0 ? sumItens : '—';
    cellTotalItens.font = { name: 'Calibri', size: 9, bold: true };
    cellTotalItens.alignment = { horizontal: 'right', vertical: 'middle' };
    if (sumItens > 0) cellTotalItens.numFormat = '#,##0';
    cellTotalItens.border = thinBorder;
    cellTotalItens.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

    const cellTotalCaixas = ws.getCell(`E${rowIdx}`);
    cellTotalCaixas.value = sumCaixas > 0 ? Math.round(sumCaixas) : '—';
    cellTotalCaixas.font = { name: 'Calibri', size: 9, bold: true };
    cellTotalCaixas.alignment = { horizontal: 'right', vertical: 'middle' };
    if (sumCaixas > 0) cellTotalCaixas.numFormat = '#,##0';
    cellTotalCaixas.border = thinBorder;
    cellTotalCaixas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

    const cellTotalVol = ws.getCell(`F${rowIdx}`);
    cellTotalVol.value = sumVol > 0 ? sumVol : 0;
    cellTotalVol.font = { name: 'Calibri', size: 9, bold: true };
    cellTotalVol.alignment = { horizontal: 'right', vertical: 'middle' };
    cellTotalVol.numFormat = '#,##0.000';
    cellTotalVol.border = thinBorder;
    cellTotalVol.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

    ws.getRow(rowIdx).height = 22;
    rowIdx++;
}

/**
 * Constrói as abas de listagem de produtos com cabeçalho padrão
 */
function buildDetailsTab(ws, items, titleText) {
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } }
    };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
    const fontHeader = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFF' } };

    // Definir as colunas da listagem
    const columns = [
        { header: 'Filial', key: 'CODFILIAL', width: 10 },
        { header: 'Código Fornecedor', key: 'CODIGO_FORNECEDOR', width: 16 },
        { header: 'Fornecedor', key: 'FORNECEDOR', width: 25 },
        { header: 'Código Produto', key: 'CODIGO_PRODUTO', width: 14 },
        { header: 'Descrição do Produto', key: 'DESCRICAO_PRODUTO', width: 38 },
        { header: 'Estoque Disponível', key: 'ESTOQUE_DISPONIVEL', width: 18 },
        { header: 'Estoque Bloqueado', key: 'ESTOQUE_BLOQUEADO', width: 18 },
        { header: 'Saldo Pedido', key: 'SALDO_PEDIDO', width: 14 },
        { header: 'Cubagem Total (m³)', key: 'CUBAGEM_TOTAL', width: 18 },
        { header: 'Qtd. Emb. Master', key: 'QTD_EMB_MASTER', width: 18 },
        { header: 'Prev. Entrega', key: 'PREV_ENTREGA', width: 14 },
        { header: 'Rua', key: 'RUA', width: 10 },
        { header: 'Prédio', key: 'PREDIO', width: 10 },
        { header: 'Apartamento', key: 'APARTAMENTO', width: 14 }
    ];

    ws.columns = columns;

    // Cabeçalho estilizado
    ws.getRow(1).height = 24;
    columns.forEach((col, idx) => {
        const colLetter = String.fromCharCode(65 + idx);
        const cell = ws.getCell(`${colLetter}1`);
        cell.font = fontHeader;
        cell.fill = headerFill;
        
        // Alinhamento padrão dos cabeçalhos
        // Col 6, 7, 8, 9, 10 são numéricos -> direita. Col 1, 11, 12, 13, 14 -> centro. Outras -> esquerda.
        const isRightAlign = idx === 5 || idx === 6 || idx === 7 || idx === 8 || idx === 9;
        const isCenterAlign = idx === 0 || (idx >= 10 && idx <= 13);
        cell.alignment = { 
            vertical: 'middle', 
            horizontal: isRightAlign ? 'right' : isCenterAlign ? 'center' : 'left' 
        };
    });

    // Inserir linhas de dados
    items.forEach(item => {
        const cubagemTotal = (item.CUBAGEM_CAIXA !== null && item.CUBAGEM_CAIXA !== undefined)
            ? (item.CUBAGEM_CAIXA * (item.QTD_EMB_MASTER || 0))
            : null;

        const row = ws.addRow({
            CODFILIAL: item.CODFILIAL,
            CODIGO_FORNECEDOR: item.CODIGO_FORNECEDOR,
            FORNECEDOR: item.FORNECEDOR,
            CODIGO_PRODUTO: item.CODIGO_PRODUTO,
            DESCRICAO_PRODUTO: item.DESCRICAO_PRODUTO,
            ESTOQUE_DISPONIVEL: item.ESTOQUE_DISPONIVEL,
            ESTOQUE_BLOQUEADO: item.ESTOQUE_BLOQUEADO,
            SALDO_PEDIDO: item.SALDO_PEDIDO,
            CUBAGEM_TOTAL: cubagemTotal,
            QTD_EMB_MASTER: item.QTD_EMB_MASTER,
            PREV_ENTREGA: item.PREV_ENTREGA,
            RUA: item.RUA,
            PREDIO: item.PREDIO,
            APARTAMENTO: item.APARTAMENTO
        });

        row.height = 18;

        // Estilizar cada célula
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.font = { name: 'Calibri', size: 9 };
            cell.border = thinBorder;
            cell.alignment = { vertical: 'middle' };

            // Formatação específica por coluna
            if (colNumber === 1) {
                // Filial
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.numFormat = '0';
            } else if (colNumber === 2 || colNumber === 4) {
                // Códigos numéricos
                cell.numFormat = '0';
            } else if (colNumber === 6) {
                // Estoque Disponível
                cell.numFormat = '#,##0';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                if (item.ESTOQUE_DISPONIVEL <= 0) {
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B91C1C' } };
                }
            } else if (colNumber === 7) {
                // Estoque Bloqueado
                cell.numFormat = '#,##0';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                if (item.ESTOQUE_BLOQUEADO > 0) {
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B45309' } };
                }
            } else if (colNumber === 8) {
                // Saldo Pedido
                cell.numFormat = '#,##0.00';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (colNumber === 9) {
                // Cubagem da Caixa
                cell.numFormat = '#,##0.00000';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                if (cell.value === null || cell.value === undefined || cell.value === '') {
                    cell.value = '—';
                    cell.font = { name: 'Calibri', size: 9, color: { argb: '94A3B8' } };
                }
            } else if (colNumber === 10) {
                // Quantidade Embalagem Master
                cell.numFormat = '#,##0.00';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                if (item.QTD_EMB_MASTER > 0) {
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: '2563EB' } };
                }
            } else if (colNumber === 11) {
                // Previsão de Entrega
                if (cell.value) {
                    cell.numFormat = 'dd/mm/yyyy';
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else {
                    cell.value = '—';
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }
            } else if (colNumber >= 12) {
                // Coordenadas (Rua, Prédio, Apartamento)
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                if (!cell.value) {
                    cell.value = '—';
                    cell.font = { name: 'Calibri', size: 9, color: { argb: '94A3B8' } };
                }
            }
        });

        // Aplicar destaque se o estoque atual for <= 0 (Urgência de Recebimento)
        if (item.ESTOQUE_DISPONIVEL <= 0) {
            row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
        }

        // Destacar em amarelo claro se Rua ou Apartamento estiverem sem endereçamento
        const isUnaddrVal = (val) => {
            const v = String(val || '').trim();
            return !v || v === '0' || v === '00' || v === '99' || v === '999' || v === '9999';
        };
        if (isUnaddrVal(item.RUA) || isUnaddrVal(item.APARTAMENTO)) {
            row.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBEB' } };
            row.getCell(14).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBEB' } };
        }
    });

    // Auto-fit das colunas (mantendo larguras mínimas saudáveis)
    ws.columns.forEach(column => {
        let maxLen = 0;
        column.eachCell({ includeEmpty: false }, (cell, rowNum) => {
            if (rowNum === 1) return;
            const valStr = cell.value ? String(cell.value) : '';
            if (valStr.length > maxLen) {
                maxLen = valStr.length;
            }
        });
        column.width = Math.max(maxLen + 4, column.width || 12);
    });

    // Auto-filtros
    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 14 }
    };
}

/**
 * Constrói a aba de Transferências em Trânsito entre Filiais
 */
function buildTransfersTab(ws, transfers, filialCode) {
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } }
    };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A8A' } };
    const fontHeader = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFF' } };

    const filialLabels = {
        '20': 'DF-CD (20)', '6': 'DF-Loja (6)',
        '21': 'GO (21)', '22': 'TO (22)', '23': 'MS (23)'
    };
    const getFilialLabel = (code) => filialLabels[String(code)] || `Filial ${code}`;

    // Definir as colunas
    const columns = [
        { header: 'Nº Transferência', key: 'NUMTRANSVENDA', width: 18 },
        { header: 'Origem', key: 'CODFILIALORIGEM', width: 14 },
        { header: 'Destino', key: 'CODFILIALDESTINO', width: 14 },
        { header: 'Cód. Produto', key: 'CODIGO_PRODUTO', width: 14 },
        { header: 'Descrição do Produto', key: 'DESCRICAO_PRODUTO', width: 40 },
        { header: 'Qtd. Unidades', key: 'QTTRANSF', width: 14 },
        { header: 'Qtd. Caixas', key: 'QTD_CAIXAS', width: 14 },
        { header: 'Cubagem Total (m³)', key: 'CUBAGEM_TOTAL', width: 18 },
        { header: 'Data Saída', key: 'DTTRANSF', width: 14 },
        { header: 'Dias em Trânsito', key: 'DIAS_EM_TRANSITO', width: 16 }
    ];

    ws.columns = columns;

    // Linha de título
    ws.mergeCells('A1:J1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `TRANSFERÊNCIAS EM TRÂNSITO — FILIAL DESTINO: ${filialCode}`;
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A8A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 32;

    // Linha de subtítulo
    ws.mergeCells('A2:J2');
    const subtitleCell = ws.getCell('A2');
    subtitleCell.value = `Total: ${transfers.length} itens em trânsito | Volume Total: ${transfers.reduce((a, t) => a + (t.CUBAGEM_TOTAL || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³`;
    subtitleCell.font = { name: 'Calibri', size: 10, color: { argb: '334155' } };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 20;

    // Cabeçalho das colunas na linha 3
    columns.forEach((col, idx) => {
        const cell = ws.getCell(3, idx + 1);
        cell.value = col.header;
        cell.font = fontHeader;
        cell.fill = headerFill;
        const isRight = idx >= 5;
        cell.alignment = { vertical: 'middle', horizontal: isRight ? 'right' : (idx <= 3 ? 'center' : 'left') };
        cell.border = thinBorder;
    });
    ws.getRow(3).height = 20;

    // Inserir dados a partir da linha 4
    transfers.forEach((t, rowOffset) => {
        const rowNum = 4 + rowOffset;
        const diasAlert = t.DIAS_EM_TRANSITO !== null && t.DIAS_EM_TRANSITO >= 7;

        const values = [
            t.NUMTRANSVENDA,
            getFilialLabel(t.CODFILIALORIGEM),
            getFilialLabel(t.CODFILIALDESTINO),
            t.CODIGO_PRODUTO,
            t.DESCRICAO_PRODUTO,
            t.QTTRANSF,
            t.QTD_CAIXAS,
            t.CUBAGEM_TOTAL,
            t.DTTRANSF,
            t.DIAS_EM_TRANSITO
        ];

        values.forEach((val, colIdx) => {
            const cell = ws.getCell(rowNum, colIdx + 1);
            cell.value = val;
            cell.font = { name: 'Calibri', size: 9 };
            cell.border = thinBorder;

            // Formatações específicas
            if (colIdx === 5 || colIdx === 6) {
                cell.numFormat = '#,##0.00';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (colIdx === 7) {
                // Cubagem
                cell.numFormat = '#,##0.000';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                if (val === null || val === undefined) {
                    cell.value = '—';
                    cell.font = { name: 'Calibri', size: 9, color: { argb: '94A3B8' } };
                }
            } else if (colIdx === 8) {
                // Data de saída
                if (val) {
                    cell.numFormat = 'dd/mm/yyyy';
                }
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            } else if (colIdx === 9) {
                // Dias em trânsito
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                if (diasAlert) {
                    // Destaque para mais de 7 dias em trânsito
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B91C1C' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
                }
                if (val !== null) {
                    cell.value = `${val} dias`;
                }
            } else if (colIdx === 0 || colIdx === 3) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            } else {
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            }
        });

        ws.getRow(rowNum).height = 18;
    });

    // Linha de total
    const totalRowNum = 4 + transfers.length;
    const totalVol = transfers.reduce((a, t) => a + (t.CUBAGEM_TOTAL || 0), 0);
    const totalUnits = transfers.reduce((a, t) => a + (t.QTTRANSF || 0), 0);
    const totalCaixas = transfers.reduce((a, t) => a + (t.QTD_CAIXAS || 0), 0);

    const totalLabels = ['TOTAL', '', '', '', `${transfers.length} itens`, totalUnits, totalCaixas, totalVol, '', ''];
    totalLabels.forEach((val, colIdx) => {
        const cell = ws.getCell(totalRowNum, colIdx + 1);
        cell.value = val;
        cell.font = { name: 'Calibri', size: 9, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };
        cell.border = thinBorder;
        if (colIdx === 5 || colIdx === 6) {
            cell.numFormat = '#,##0.00';
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (colIdx === 7) {
            cell.numFormat = '#,##0.000';
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else {
            cell.alignment = { vertical: 'middle', horizontal: colIdx === 0 ? 'left' : 'center' };
        }
    });
    ws.getRow(totalRowNum).height = 22;

    // Auto-filtro
    ws.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3, column: 10 }
    };
}

/**
 * Gera um arquivo Excel contendo todos os produtos sem cubagem ou com dimensões zeradas
 * 
 * @param {Array} products Lista de produtos sem cubagem
 * @returns {Promise<string>} Caminho do arquivo gerado
 */
async function generateProductsWithoutCubageExcel(products) {
    const fileName = 'produtos_sem_cubagem.xlsx';
    const filePath = path.join(EXCEL_DIR, fileName);

    try {
        if (!fs.existsSync(EXCEL_DIR)) {
            fs.mkdirSync(EXCEL_DIR, { recursive: true });
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Brago App System';
        workbook.created = new Date();

        const productsWithStock = products.filter(p => (Number(p.ESTOQUE_20) || 0) > 0);
        const productsWithoutStock = products.filter(p => (Number(p.ESTOQUE_20) || 0) <= 0);

        const wsWithStock = workbook.addWorksheet('Com Estoque Filial 20');
        wsWithStock.views = [{ showGridLines: true }];
        buildProductsSheet(wsWithStock, productsWithStock, 'PRODUTOS SEM CUBAGEM COM ESTOQUE NA FILIAL 20');

        const wsWithoutStock = workbook.addWorksheet('Sem Estoque Filial 20');
        wsWithoutStock.views = [{ showGridLines: true }];
        buildProductsSheet(wsWithoutStock, productsWithoutStock, 'PRODUTOS SEM CUBAGEM SEM ESTOQUE NA FILIAL 20');

        await workbook.xlsx.writeFile(filePath);
        return filePath;

    } catch (err) {
        logger.error(`❌ Erro ao gerar planilha Excel de produtos sem cubagem: ${err.message}`);
        throw err;
    }
}

/**
 * Constrói uma aba com a listagem de produtos sem cubagem
 */
function buildProductsSheet(ws, items, titleText) {
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'CBD5E1' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } }
    };

    const fontTitle = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
    const fontHeader = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    
    // Título principal
    ws.mergeCells('A1:J1');
    const titleCell = ws.getCell('A1');
    titleCell.value = titleText;
    titleCell.font = fontTitle;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 36;

    // Subtítulo
    ws.mergeCells('A2:J2');
    const subtitleCell = ws.getCell('A2');
    subtitleCell.value = `Total de itens: ${items.length} produtos | Gerado em: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`;
    subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: '475569' } };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 24;

    // Cabeçalhos
    const columns = [
        { header: 'Cód. Produto', key: 'CODPROD', width: 14 },
        { header: 'Descrição do Produto', key: 'DESCRICAO', width: 45 },
        { header: 'Qtd. Unid. Caixa', key: 'QTUNITCX', width: 16 },
        { header: 'Cód. Fornecedor', key: 'CODFORNEC', width: 16 },
        { header: 'Fornecedor', key: 'FORNECEDOR', width: 25 },
        { header: 'Estoque Físico (20)', key: 'ESTOQUE_20', width: 18 },
        { header: 'Estoque Disponível (20)', key: 'ESTOQUE_DISP_20', width: 20 },
        { header: 'Altura (cm)', key: 'ALTURAM3', width: 14 },
        { header: 'Largura (cm)', key: 'LARGURAM3', width: 14 },
        { header: 'Comprimento (cm)', key: 'COMPRIMENTOM3', width: 18 }
    ];
    ws.columns = columns;

    ws.getRow(3).height = 24;
    columns.forEach((col, idx) => {
        const cell = ws.getCell(3, idx + 1);
        cell.value = col.header;
        cell.font = fontHeader;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
        const isRight = idx === 2 || (idx >= 5 && idx <= 9);
        cell.alignment = { vertical: 'middle', horizontal: isRight ? 'right' : (idx === 0 || idx === 3 ? 'center' : 'left') };
        cell.border = thinBorder;
    });

    // Adicionar Linhas
    items.forEach((row, rowIndex) => {
        const rowNum = 4 + rowIndex;
        const values = [
            row.CODPROD,
            row.DESCRICAO,
            row.QTUNITCX,
            row.CODFORNEC,
            row.FORNECEDOR || 'SEM FORNECEDOR',
            row.ESTOQUE_20 || 0,
            row.ESTOQUE_DISP_20 || 0,
            row.ALTURAM3 || 0,
            row.LARGURAM3 || 0,
            row.COMPRIMENTOM3 || 0
        ];

        values.forEach((val, colIdx) => {
            const cell = ws.getCell(rowNum, colIdx + 1);
            cell.value = val;
            cell.font = { name: 'Calibri', size: 9 };
            cell.border = thinBorder;

            if (colIdx === 0 || colIdx === 3) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.numFormat = '0';
            } else if (colIdx === 2) {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                cell.numFormat = '#,##0';
            } else if (colIdx === 5 || colIdx === 6) {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                cell.numFormat = '#,##0';
                if (Number(val) > 0) {
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: '166534' } }; // Verde para estoque ativo
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } };
                }
            } else if (colIdx >= 7) {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
                cell.numFormat = '#,##0.00';
                if (!val || Number(val) === 0) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B91C1C' } };
                }
            } else {
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            }
        });
        ws.getRow(rowNum).height = 18;
    });

    ws.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3, column: 10 }
    };
}

module.exports = {
    generateLogisticsExcel,
    generateProductsWithoutCubageExcel
};
