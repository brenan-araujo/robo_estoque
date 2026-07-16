const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const EXCEL_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_compras.xlsx');
const EXCEL_DRYRUN_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_compras_dryrun.xlsx');

/**
 * Gera uma planilha Excel interativa para o Relatório Semanal de Compras.
 * @param {Array} data Lista de produtos retornada pelo Oracle Service
 * @param {boolean} dryRun Indica se salva no caminho de teste
 * @returns {Promise<string>} Caminho do arquivo Excel gerado
 */
async function generatePurchasingExcel(data, dryRun = false) {
    const filePath = dryRun ? EXCEL_DRYRUN_PATH : EXCEL_PATH;

    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Brago App System';
        workbook.lastModifiedBy = 'Brago App System';
        workbook.created = new Date();
        workbook.modified = new Date();

        // Contadores
        const totalCritico = data.filter(p => p.STATUS === 'CRITICO').length;
        const totalAtencao = data.filter(p => p.STATUS === 'ATENCAO').length;
        const totalSaudavel = data.filter(p => p.STATUS === 'SAUDAVEL').length;
        const totalGeral = data.length;
        const saudeGeralPct = totalGeral > 0 ? (totalSaudavel / totalGeral) : 0;

        // Aba 1: Resumo Executivo
        const wsDashboard = workbook.addWorksheet('Resumo Executivo');
        wsDashboard.views = [{ showGridLines: true }];
        buildDashboardTab(wsDashboard, data, totalCritico, totalAtencao, totalSaudavel, totalGeral, saudeGeralPct);

        // Aba 2: A Comprar (Críticos)
        const wsCritico = workbook.addWorksheet('1. A Comprar (Críticos)');
        wsCritico.views = [{ showGridLines: true }];
        const criticoItems = data.filter(p => p.STATUS === 'CRITICO');
        buildProductTab(wsCritico, criticoItems, '990000', 'FEF2F2');

        // Aba 3: Em Trânsito (Atenção)
        const wsAtencao = workbook.addWorksheet('2. Em Trânsito (Atenção)');
        wsAtencao.views = [{ showGridLines: true }];
        const atencaoItems = data.filter(p => p.STATUS === 'ATENCAO');
        buildProductTab(wsAtencao, atencaoItems, '1E3A8A', 'EFF6FF');

        // Aba 4: Saudáveis (Estoque Seguro)
        const wsSaudavel = workbook.addWorksheet('3. Saudáveis (Estoque Seguro)');
        wsSaudavel.views = [{ showGridLines: true }];
        const saudavelItems = data.filter(p => p.STATUS === 'SAUDAVEL');
        buildProductTab(wsSaudavel, saudavelItems, '065F46', 'F0FDF4');

        await workbook.xlsx.writeFile(filePath);
        logger.info(`✅ Planilha Excel gerada com sucesso em: ${filePath}`);
        return filePath;
    } catch (err) {
        logger.error(`❌ Erro ao gerar planilha Excel de compras: ${err.message}`);
        throw err;
    }
}

/**
 * Constrói a aba de Resumo Executivo (Dashboard)
 */
function buildDashboardTab(ws, data, critico, atencao, saudavel, total, saudePct) {
    // Definir larguras manuais para as colunas da aba de resumo
    ws.columns = [
        { width: 4 },   // A
        { width: 32 },  // B (Fornecedor)
        { width: 14 },  // C (Críticos)
        { width: 14 },  // D (Atenção)
        { width: 14 },  // E (Saudáveis)
        { width: 14 },  // F (Total)
        { width: 18 }   // G (Saúde %)
    ];

    // Estilos padrão
    const fontTitle = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
    const fontHeader = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFF' } };
    const fontSection = { name: 'Calibri', size: 11, bold: true, color: { argb: '1E293B' } };
    const fontKpiLabel = { name: 'Calibri', size: 9, bold: true, color: { argb: '475569' } };
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'CBD5E1' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } }
    };

    // 1. Título do Dashboard
    ws.mergeCells('B2:G2');
    const titleCell = ws.getCell('B2');
    titleCell.value = 'DIAGNÓSTICO DE COBERTURA DE ESTOQUE — BRAGO';
    titleCell.font = fontTitle;
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '1E293B' }
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 36;

    // 2. KPI Cards
    // Card 1: A Comprar
    ws.mergeCells('B5:B6');
    const kpi1 = ws.getCell('B5');
    kpi1.value = `A COMPRAR (Críticos)\n\n${critico} itens`;
    kpi1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '990000' } };
    kpi1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
    kpi1.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    kpi1.border = thinBorder;

    // Card 2: Em Trânsito
    ws.mergeCells('C5:C6');
    const kpi2 = ws.getCell('C5');
    kpi2.value = `EM TRÂNSITO (Atenção)\n\n${atencao} itens`;
    kpi2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '1E3A8A' } };
    kpi2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    kpi2.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    kpi2.border = thinBorder;

    // Card 3: Saudáveis
    ws.mergeCells('D5:D6');
    const kpi3 = ws.getCell('D5');
    kpi3.value = `SAUDÁVEIS (Seguro)\n\n${saudavel} itens`;
    kpi3.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '065F46' } };
    kpi3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } };
    kpi3.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    kpi3.border = thinBorder;

    // Card 4: Saúde Geral
    ws.mergeCells('E5:E6');
    const kpi4 = ws.getCell('E5');
    const pctStr = (saudePct * 100).toFixed(0);
    kpi4.value = `SAÚDE GERAL\n\n${pctStr}%`;
    let saudeBg = 'F0FDF4';
    let saudeColor = '065F46';
    if (saudePct < 0.4) {
        saudeBg = 'FEF2F2';
        saudeColor = '990000';
    } else if (saudePct < 0.7) {
        saudeBg = 'FFFBEB';
        saudeColor = '92400E';
    }
    kpi4.font = { name: 'Calibri', size: 10, bold: true, color: { argb: saudeColor } };
    kpi4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: saudeBg } };
    kpi4.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    kpi4.border = thinBorder;

    // Card 5: Total Monitorado
    ws.mergeCells('F5:G6');
    const kpi5 = ws.getCell('F5');
    kpi5.value = `TOTAL MONITORADO\n\n${total} itens`;
    kpi5.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '1E293B' } };
    kpi5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    kpi5.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    kpi5.border = thinBorder;

    ws.getRow(5).height = 24;
    ws.getRow(6).height = 24;

    // 3. Top 10 Fornecedores Críticos
    ws.mergeCells('B9:G9');
    const sectCell = ws.getCell('B9');
    sectCell.value = 'RESUMO POR FORNECEDOR (TOP 10 MAIS CRÍTICOS)';
    sectCell.font = fontSection;
    ws.getRow(9).height = 24;

    // Cabeçalho da tabela de resumo
    const headers = ['FORNECEDOR', 'A COMPRAR', 'EM TRÂNSITO', 'SAUDÁVEL', 'TOTAL', 'CRITICIDADE %'];
    headers.forEach((h, idx) => {
        const colLetter = String.fromCharCode(66 + idx); // B, C, D...
        const cell = ws.getCell(`${colLetter}10`);
        cell.value = h;
        cell.font = fontHeader;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: idx === 0 ? 'left' : 'right' };
        cell.border = thinBorder;
    });
    ws.getRow(10).height = 20;

    // Agrupamento de fornecedores
    const supplierMap = {};
    data.forEach(p => {
        const name = p.NOME_FORNECEDOR || `Fornecedor ${p.CODFORNEC || 'N/I'}`;
        if (!supplierMap[name]) {
            supplierMap[name] = { nome: name, critico: 0, atencao: 0, saudavel: 0, total: 0 };
        }
        supplierMap[name].total++;
        if (p.STATUS === 'CRITICO') supplierMap[name].critico++;
        else if (p.STATUS === 'ATENCAO') supplierMap[name].atencao++;
        else if (p.STATUS === 'SAUDAVEL') supplierMap[name].saudavel++;
    });

    const supplierSummary = Object.values(supplierMap)
        .sort((a, b) => {
            if (b.critico !== a.critico) return b.critico - a.critico;
            return b.atencao - a.atencao;
        })
        .slice(0, 10);

    // Escrever linhas da tabela
    let rowY = 11;
    supplierSummary.forEach((s, sIdx) => {
        const rowBg = sIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
        const cells = [
            ws.getCell(`B${rowY}`), // Fornecedor
            ws.getCell(`C${rowY}`), // A Comprar
            ws.getCell(`D${rowY}`), // Em Trânsito
            ws.getCell(`E${rowY}`), // Saudável
            ws.getCell(`F${rowY}`), // Total
            ws.getCell(`G${rowY}`)  // % Criticidade
        ];

        cells[0].value = s.nome;
        cells[0].alignment = { vertical: 'middle', horizontal: 'left' };
        
        cells[1].value = s.critico;
        cells[1].alignment = { vertical: 'middle', horizontal: 'right' };
        cells[1].font = { name: 'Calibri', size: 10, bold: s.critico > 0, color: { argb: s.critico > 0 ? '990000' : '000000' } };

        cells[2].value = s.atencao;
        cells[2].alignment = { vertical: 'middle', horizontal: 'right' };
        cells[2].font = { name: 'Calibri', size: 10, bold: s.atencao > 0, color: { argb: s.atencao > 0 ? '1E3A8A' : '000000' } };

        cells[3].value = s.saudavel;
        cells[3].alignment = { vertical: 'middle', horizontal: 'right' };
        cells[3].font = { name: 'Calibri', size: 10, color: { argb: '065F46' } };

        cells[4].value = s.total;
        cells[4].alignment = { vertical: 'middle', horizontal: 'right' };
        cells[4].font = { name: 'Calibri', size: 10, bold: true };

        const critPct = s.total > 0 ? (s.critico / s.total) : 0;
        cells[5].value = critPct;
        cells[5].numFormat = '0%';
        cells[5].alignment = { vertical: 'middle', horizontal: 'right' };
        cells[5].font = { name: 'Calibri', size: 10, bold: critPct > 0, color: { argb: critPct > 0.5 ? '990000' : '000000' } };

        cells.forEach(c => {
            c.border = thinBorder;
            if (c.address !== cells[1].address && c.address !== cells[2].address && c.address !== cells[3].address && c.address !== cells[5].address) {
                c.font = { name: 'Calibri', size: 10 };
            }
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        });

        ws.getRow(rowY).height = 18;
        rowY++;
    });
}

/**
 * Constrói abas detalhadas de produtos
 */
function buildProductTab(ws, items, headerColorHex, softBgColorHex) {
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } }
    };

    // Configuração de colunas
    ws.columns = [
        { header: 'Código Fornecedor', key: 'CODFORNEC' },
        { header: 'Fornecedor', key: 'NOME_FORNECEDOR' },
        { header: 'Filial', key: 'NOMEFILIAL' },
        { header: 'Código Produto', key: 'CODPROD' },
        { header: 'Descrição do Produto', key: 'DESCRICAO' },
        { header: 'Curva ABC', key: 'CURVA_ABC' },
        { header: 'Estoque Disponível', key: 'ESTOQUE_DISPONIVEL' },
        { header: 'Venda Diária Peso', key: 'VENDA_DIA' },
        { header: 'Venda Diária 90 dias', key: 'VENDA_DIA_90' },
        { header: 'Cobertura Física (Dias)', key: 'COBERTURA_FISICA' },
        { header: 'Tempo Fornecedor (Dias)', key: 'TEMPO_FORNEC' },
        { header: 'Saldo Pedido', key: 'SALDO_PEDIDO' },
        { header: 'Prev. Entrega', key: 'DT_PREVISAO_ENTREGA' },
        { header: 'Cobertura Projetada (Dias)', key: 'COBERTURA_TOTAL' },
        { header: 'Sugestão de Compra (Quantidade)', key: 'SUGESTAO' }
    ];

    // Formatar cabeçalho
    const headerRow = ws.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell(cell => {
        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: headerColorHex }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = thinBorder;
    });

    // Inserir os dados
    items.forEach((p, index) => {
        // Cálculo da sugestão de compra (Qtd)
        // Se a Cobertura Total é menor que o Tempo do Fornecedor, sugere comprar o saldo necessário para atingir o lead time
        const tempoFornec = Number(p.TEMPO_FORNEC) || 7;
        const vendaDia = Number(p.VENDA_DIA) || 0;
        const estoqueDisp = Number(p.ESTOQUE_DISPONIVEL) || 0;
        const saldoPedido = Number(p.SALDO_PEDIDO) || 0;

        // Arredonda VDA para 3 casas decimais — mesmo valor exibido na coluna —
        // e recalcula as coberturas com esse valor para garantir consistência interna.
        const vendaDiaExibida = Math.round(vendaDia * 1000) / 1000;
        const coberturaFisica = vendaDiaExibida > 0
            ? Math.round((estoqueDisp / vendaDiaExibida) * 10) / 10
            : (estoqueDisp > 0 ? 9999 : 0);
        const coberturaTotal = vendaDiaExibida > 0
            ? Math.round(((estoqueDisp + saldoPedido) / vendaDiaExibida) * 10) / 10
            : (estoqueDisp + saldoPedido > 0 ? 9999 : 0);

        let sugestaoQtd = 0;
        if (coberturaTotal < tempoFornec && vendaDiaExibida > 0) {
            // Sugere a quantidade necessária para cobrir a venda do lead time subtraindo o estoque atual + saldo de pedidos
            const rawNeeded = (vendaDiaExibida * tempoFornec) - (estoqueDisp + saldoPedido);
            if (estoqueDisp === 0 && rawNeeded > 0) {
                // Se o estoque físico estiver zerado, arredonda sempre para cima (mínimo de 1)
                sugestaoQtd = Math.max(1, Math.ceil(rawNeeded));
            } else {
                sugestaoQtd = Math.max(0, Math.round(rawNeeded));
            }
        }

        const rowData = {
            CODFORNEC: p.CODFORNEC,
            NOME_FORNECEDOR: p.NOME_FORNECEDOR ? p.NOME_FORNECEDOR.toUpperCase() : 'N/I',
            NOMEFILIAL: p.NOMEFILIAL ? p.NOMEFILIAL.toUpperCase() : `FILIAL ${p.CODFILIAL}`,
            CODPROD: p.CODPROD,
            DESCRICAO: `${p.DESCRICAO} (${p.EMBALAGEM || 'UN'} ${p.UNIDADE || ''})`.toUpperCase(),
            CURVA_ABC: p.CURVA_ABC || 'C',
            ESTOQUE_DISPONIVEL: estoqueDisp,
            VENDA_DIA: vendaDiaExibida,
            VENDA_DIA_90: Math.round((Number(p.VENDA_DIA_90) || 0) * 1000) / 1000,
            COBERTURA_FISICA: coberturaFisica === 9999 ? 9999 : coberturaFisica,
            TEMPO_FORNEC: tempoFornec,
            SALDO_PEDIDO: saldoPedido,
            DT_PREVISAO_ENTREGA: p.DT_PREVISAO_ENTREGA ? new Date(p.DT_PREVISAO_ENTREGA) : null,
            COBERTURA_TOTAL: coberturaTotal === 9999 ? 9999 : coberturaTotal,
            SUGESTAO: sugestaoQtd
        };

        const row = ws.addRow(rowData);
        row.height = 18;

        const rowBg = index % 2 === 0 ? 'FFFFFF' : 'F8FAFC';

        // Estilos específicos para células de dados
        row.eachCell((cell, colNumber) => {
            cell.border = thinBorder;
            cell.font = { name: 'Calibri', size: 9 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };

            // Alinhamentos e Formatações
            if ([1, 4].includes(colNumber)) {
                // Cód Fornecedor, Cód Produto
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.numFormat = '@';
            } else if ([2, 3, 5].includes(colNumber)) {
                // Fornecedor, Filial, Descrição
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            } else if (colNumber === 6) {
                // Curva ABC — formatação visual com cores
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                const curva = cell.value;
                if (curva === 'A') {
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: '065F46' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1FAE5' } };
                } else if (curva === 'B') {
                    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: '92400E' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
                } else {
                    cell.font = { name: 'Calibri', size: 9, color: { argb: '475569' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
                }
            } else {
                // Numéricos
                cell.alignment = { vertical: 'middle', horizontal: 'right' };

                if (colNumber === 7) {
                    // Estoque Disponível
                    cell.numFormat = '#,##0';
                    if (estoqueDisp <= 0) {
                        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B91C1C' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
                    }
                } else if (colNumber === 8 || colNumber === 9) {
                    // Venda Diária Peso (8) e Venda Diária 90 dias (9) — 3 casas decimais
                    cell.numFormat = '#,##0.000';
                } else if (colNumber === 10) {
                    // Cobertura Física
                    if (typeof cell.value === 'number') {
                        if (cell.value === 9999) {
                            cell.value = '9999d';
                        } else {
                            cell.numFormat = '#,##0.0"d"';
                            if (cell.value < tempoFornec) {
                                cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B91C1C' } };
                            }
                        }
                    }
                } else if (colNumber === 11) {
                    // Tempo Fornecedor
                    cell.numFormat = '#,##0"d"';
                } else if (colNumber === 12) {
                    // Saldo Pedido
                    cell.numFormat = '#,##0';
                    if (saldoPedido > 0) {
                        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: '2563EB' } };
                    } else {
                        cell.value = '—';
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        cell.font = { name: 'Calibri', size: 9, color: { argb: '94A3B8' } };
                    }
                } else if (colNumber === 13) {
                    // Previsão de Entrega
                    if (cell.value) {
                        cell.numFormat = 'dd/mm/yyyy';
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    } else {
                        cell.value = '—';
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        cell.font = { name: 'Calibri', size: 9, color: { argb: '94A3B8' } };
                    }
                } else if (colNumber === 14) {
                    // Cobertura Total
                    if (typeof cell.value === 'number') {
                        if (cell.value === 9999) {
                            cell.value = '9999d';
                        } else {
                            cell.numFormat = '#,##0.0"d"';
                            if (cell.value < tempoFornec) {
                                cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'B91C1C' } };
                            } else if (cell.value < tempoFornec + 5) {
                                cell.font = { name: 'Calibri', size: 9, color: { argb: 'D97706' } }; // Atenção (laranja)
                            } else {
                                cell.font = { name: 'Calibri', size: 9, color: { argb: '059669' } }; // Saudável (verde)
                            }
                        }
                    }
                } else if (colNumber === 15) {
                    // Sugestão de Compra
                    cell.numFormat = '#,##0';
                    if (sugestaoQtd > 0) {
                        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'B91C1C' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: softBgColorHex } };
                    } else {
                        cell.value = '—';
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        cell.font = { name: 'Calibri', size: 9, color: { argb: '94A3B8' } };
                    }
                }
            }
        });
    });

    // Auto-fit das colunas (exceto a primeira linha de cabeçalho para evitar larguras desproporcionais se houver algum bug)
    ws.columns.forEach(column => {
        let maxLen = 0;
        column.eachCell({ includeEmpty: false }, (cell, rowNum) => {
            if (rowNum === 1) return; // ignora o cabeçalho para largura
            const valStr = cell.value ? String(cell.value) : '';
            if (valStr.length > maxLen) {
                maxLen = valStr.length;
            }
        });
        column.width = Math.max(maxLen + 4, 11);
    });

    // Filtros no cabeçalho
    ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 15 }
    };
}

module.exports = {
    generatePurchasingExcel
};
