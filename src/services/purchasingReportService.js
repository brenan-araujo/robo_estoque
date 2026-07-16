const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CronJob } = require('cron');
const purchasingOracleService = require('./purchasingOracleService');
const purchasingExcelService = require('./purchasingExcelService');
const whatsapp = require('./whatsappService');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');

const LOGO_PATH = path.join(__dirname, '..', '..', 'data', 'brago_logo.png');
const PDF_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_compras.pdf');
const PDF_DRYRUN_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_compras_dryrun.pdf');
let cronJob = null;

/**
 * Gera o relatório PDF semanal de cobertura de compras
 * @param {Array} data Lista de produtos com dados de cobertura
 * @param {boolean} dryRun Indica se é uma execução de teste
 * @returns {Promise<string>} Caminho do PDF gerado
 */
async function generatePurchasingPdf(data, dryRun = false) {
    return new Promise((resolve, reject) => {
        try {
            const pdfPath = dryRun ? PDF_DRYRUN_PATH : PDF_PATH;

            // Garantir que a pasta destino existe
            const dir = path.dirname(pdfPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
            const stream = fs.createWriteStream(pdfPath);
            doc.pipe(stream);

            // ----- Cálculos auxiliares para a semana corrente -----
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0=Dom, 1=Seg...
            const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            const monday = new Date(now);
            monday.setDate(now.getDate() + diffToMon);
            const friday = new Date(monday);
            friday.setDate(monday.getDate() + 4);

            const fmtDate = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const fmtDateFull = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const weekLabel = `Semana ${fmtDate(monday)} a ${fmtDateFull(friday)}`;

            // ----- Contadores de status -----
            const countCritico = data.filter(p => p.STATUS === 'CRITICO').length;
            const countAtencao = data.filter(p => p.STATUS === 'ATENCAO').length;
            const countSaudavel = data.filter(p => p.STATUS === 'SAUDAVEL').length;

            // ----- drawHeader — chamado em toda nova página -----
            const drawHeader = () => {
                // Fundo degradê off-white premium
                const gradient = doc.linearGradient(0, 0, 0, 841.89);
                gradient.stop(0, '#f8f9fa')
                        .stop(1, '#edf0f2');
                doc.rect(0, 0, 595.28, 841.89).fill(gradient);

                // Logo
                if (fs.existsSync(LOGO_PATH)) {
                    try {
                        doc.image(LOGO_PATH, 36, 25, { width: 130 });
                    } catch (e) {
                        logger.error(`Erro ao adicionar logo ao PDF: ${e.message}`);
                    }
                } else {
                    doc.fillColor('#002bf0').fontSize(24).font('Helvetica-Bold').text('BRAGO', 36, 30);
                }

                // Título e metadados no topo direito
                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('RELATÓRIO SEMANAL DE COMPRAS', 220, 30, { align: 'right' });
                doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`${weekLabel}${dryRun ? ' | MODO DRY-RUN' : ''}`, 220, 48, { align: 'right' });

                // Linha divisória Azul Royal
                doc.strokeColor('#002bf0').lineWidth(2).moveTo(36, 68).lineTo(559, 68).stroke();
            };

            drawHeader();

            const detailedData = data.filter(p => p.STATUS !== 'SAUDAVEL');
            let y = 85;

            if (detailedData.length === 0) {
                // Caso não existam produtos com desvio
                y = 300;
                doc.roundedRect(80, y, 435, 100, 8).fill('#ffffff');
                doc.roundedRect(80, y, 435, 100, 8).lineWidth(1).strokeColor('#cbd5e1').stroke();

                // Indicador lateral verde (positivo)
                doc.rect(84, y + 10, 4, 80).fill('#10b981');

                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('Estoque 100% Saudável', 105, y + 25);
                doc.fillColor('#475569').fontSize(10).font('Helvetica').text('Todos os produtos monitorados possuem cobertura adequada.', 105, y + 45, { width: 390 });
                doc.fillColor('#10b981').fontSize(9).font('Helvetica-Bold').text('Nenhuma ação de compra necessária!', 105, y + 65);
            } else {
                // ===== KPI CARDS (UX/UI Funil de Decisão) =====
                // Card 1: A COMPRAR (🔴 - Ação Urgente)
                doc.roundedRect(36, y, 165, 44, 4).fill('#fef2f2');
                doc.roundedRect(36, y, 165, 44, 4).lineWidth(0.5).strokeColor('#fecaca').stroke();
                doc.circle(46, y + 28, 3).fill('#dc2626');
                doc.fillColor('#b91c1c').fontSize(7.5).font('Helvetica-Bold').text('A COMPRAR (Urgente)', 54, y + 8);
                doc.fillColor('#dc2626').fontSize(18).font('Helvetica-Bold').text(String(countCritico), 54, y + 20);

                // Card 2: EM TRÂNSITO (🔵 - Acompanhar)
                doc.roundedRect(215, y, 165, 44, 4).fill('#eff6ff');
                doc.roundedRect(215, y, 165, 44, 4).lineWidth(0.5).strokeColor('#bfdbfe').stroke();
                doc.circle(225, y + 28, 3).fill('#2563eb');
                doc.fillColor('#1e40af').fontSize(7.5).font('Helvetica-Bold').text('EM TRÂNSITO (Acompanhar)', 233, y + 8);
                doc.fillColor('#2563eb').fontSize(18).font('Helvetica-Bold').text(String(countAtencao), 233, y + 20);

                // Card 3: SAÚDE GERAL (🟢 - Estoque Seguro)
                doc.roundedRect(394, y, 165, 44, 4).fill('#f8fafc');
                doc.roundedRect(394, y, 165, 44, 4).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
                doc.fillColor('#475569').fontSize(7.5).font('Helvetica-Bold').text('SAÚDE GERAL', 404, y + 8);

                const healthPct = data.length > 0 ? Math.round((countSaudavel / data.length) * 100) : 0;
                let healthColor = '#dc2626'; // < 40%
                if (healthPct >= 70) healthColor = '#10b981';
                else if (healthPct >= 40) healthColor = '#f59e0b';

                // Barra de progresso
                const barX = 404;
                const barY = y + 22;
                const barW = 110;
                const barH = 6;
                doc.roundedRect(barX, barY, barW, barH, 3).fill('#e2e8f0');
                if (healthPct > 0) {
                    const fillW = Math.max(4, (barW * healthPct) / 100);
                    doc.roundedRect(barX, barY, fillW, barH, 3).fill(healthColor);
                }
                doc.fillColor(healthColor).fontSize(11).font('Helvetica-Bold').text(`${healthPct}%`, 518, y + 18, { width: 35, align: 'right' });

                y += 58;

                // ===== RESUMO POR FORNECEDOR (TOP 10 MAIS CRÍTICOS) =====
                doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('RESUMO POR FORNECEDOR (TOP 10 MAIS CRÍTICOS)', 36, y);
                y += 16;

                // Agrupamento por fornecedor
                const supplierMap = {};
                detailedData.forEach(p => {
                    const key = p.NOME_FORNECEDOR || `Fornecedor ${p.CODFORNEC || 'N/I'}`;
                    if (!supplierMap[key]) {
                        supplierMap[key] = { nome: key, critico: 0, atencao: 0, total: 0 };
                    }
                    supplierMap[key].total++;
                    if (p.STATUS === 'CRITICO') supplierMap[key].critico++;
                    else if (p.STATUS === 'ATENCAO') supplierMap[key].atencao++;
                });

                const supplierSummary = Object.values(supplierMap)
                    .sort((a, b) => {
                        if (b.critico !== a.critico) return b.critico - a.critico;
                        return b.atencao - a.atencao;
                    })
                    .slice(0, 10);

                // Header da tabela de resumo
                const summaryColWidths = { fornecedor: 260, crit: 80, atenc: 80, total: 80 };
                const summaryRowH = 16;

                doc.roundedRect(36, y, 523, summaryRowH, 0).fill('#1e293b');
                doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
                doc.text('FORNECEDOR', 42, y + 4, { width: summaryColWidths.fornecedor });
                doc.text('A COMPRAR', 310, y + 4, { width: summaryColWidths.crit, align: 'right' });
                doc.text('EM TRÂNSITO', 390, y + 4, { width: summaryColWidths.atenc, align: 'right' });
                doc.text('TOTAL', 470, y + 4, { width: summaryColWidths.total, align: 'right' });
                y += summaryRowH;

                // Linhas da tabela de resumo
                supplierSummary.forEach((s, idx) => {
                    const rowFill = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                    doc.rect(36, y, 523, summaryRowH).fill(rowFill);

                    doc.fillColor('#334155').fontSize(8).font('Helvetica');
                    doc.text(s.nome, 42, y + 4, { width: summaryColWidths.fornecedor, ellipsis: true, height: 10 });

                    doc.fillColor('#dc2626').font('Helvetica-Bold').text(String(s.critico), 310, y + 4, { width: summaryColWidths.crit, align: 'right' });
                    doc.fillColor('#2563eb').font('Helvetica-Bold').text(String(s.atencao), 390, y + 4, { width: summaryColWidths.atenc, align: 'right' });
                    doc.fillColor('#0f172a').font('Helvetica-Bold').text(String(s.total), 470, y + 4, { width: summaryColWidths.total, align: 'right' });

                    y += summaryRowH;
                });

                y += 24; // Espaço após tabela de resumo

                // ===== FUNÇÃO PARA RENDERIZAR UMA SEÇÃO DETALHADA =====
                const renderSection = (sectionTitle, sectionItems, isSection1) => {
                    if (sectionItems.length === 0) return;

                    // Quebra de página se não houver espaço suficiente para o cabeçalho da seção
                    if (y > 700) {
                        doc.addPage();
                        drawHeader();
                        y = 85;
                    }

                    // Cabeçalho da Seção
                    const sectionBg = isSection1 ? '#991b1b' : '#1e3a8a';
                    doc.roundedRect(36, y, 523, 20, 3).fill(sectionBg);
                    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
                       .text(sectionTitle, 46, y + 5);
                    y += 26;

                    // Agrupar por fornecedor
                    const detailBySupplier = {};
                    sectionItems.forEach(p => {
                        const sKey = p.NOME_FORNECEDOR || `Fornecedor ${p.CODFORNEC || 'N/I'}`;
                        if (!detailBySupplier[sKey]) {
                            detailBySupplier[sKey] = { codFornec: p.CODFORNEC, items: [] };
                        }
                        detailBySupplier[sKey].items.push(p);
                    });

                    // Ordenar fornecedores por quantidade de itens de forma decrescente (mais críticos primeiro)
                    const sortedSupplierKeys = Object.keys(detailBySupplier).sort((a, b) => {
                        const countA = detailBySupplier[a].items.length;
                        const countB = detailBySupplier[b].items.length;
                        if (countB !== countA) return countB - countA;
                        return a.localeCompare(b);
                    });

                    const filialOrder = ['20 + 6', '21', '22', '23'];

                    const drawDetailTableHeader = () => {
                        doc.rect(36, y, 523, 14).fill('#f8fafc');
                        doc.fillColor('#475569').font('Helvetica-Bold').fontSize(6); // Reduzido para 6pt para caber os textos por extenso
                        doc.text('Código', 38, y + 4, { width: 38, ellipsis: true });
                        doc.text('Descrição', 78, y + 4, { width: 148, ellipsis: true });
                        doc.text('Estoque', 228, y + 4, { width: 42, align: 'right' });
                        doc.text('Venda Diária', 272, y + 4, { width: 40, align: 'right' });
                        doc.text('Cobertura', 316, y + 4, { width: 42, align: 'right' });
                        doc.text('Tempo', 360, y + 4, { width: 38, align: 'right' });
                        doc.text('Pedido', 400, y + 4, { width: 42, align: 'right' });
                        doc.text('Cálculo', 444, y + 4, { width: 34, align: 'right' });
                        doc.text('AÇÃO', 482, y + 4, { width: 72, align: 'right' });
                        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                        y += 14;
                    };

                    let currentSupplierLabel = '';
                    let currentBranchLabel = '';

                    sortedSupplierKeys.forEach(supplierName => {
                        const supplierData = detailBySupplier[supplierName];
                        const codFornec = supplierData.codFornec;

                        if (y > 720) {
                            doc.addPage();
                            drawHeader();
                            y = 85;
                        }

                        currentSupplierLabel = `FORNECEDOR: ${supplierName.toUpperCase()} (${codFornec})`;
                        doc.roundedRect(36, y, 523, 20, 3).fill('#1e293b');
                        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5)
                           .text(currentSupplierLabel, 44, y + 5);
                        y += 26;

                        const branchesByFilial = {};
                        supplierData.items.forEach(p => {
                            const fKey = String(p.CODFILIAL);
                            if (!branchesByFilial[fKey]) {
                                branchesByFilial[fKey] = {
                                    nome: p.NOMEFILIAL || `Filial ${fKey}`,
                                    items: []
                                };
                            }
                            branchesByFilial[fKey].items.push(p);
                        });

                        const sortedBranches = Object.keys(branchesByFilial).sort((a, b) => {
                            const idxA = filialOrder.indexOf(a);
                            const idxB = filialOrder.indexOf(b);
                            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                            if (idxA !== -1) return -1;
                            if (idxB !== -1) return 1;
                            return a.localeCompare(b);
                        });

                        sortedBranches.forEach(fKey => {
                            const branchData = branchesByFilial[fKey];
                            currentBranchLabel = `── ${branchData.nome.toUpperCase()} (${fKey}) ──`;

                            if (y > 720) {
                                doc.addPage();
                                drawHeader();
                                y = 85;

                                doc.roundedRect(36, y, 523, 20, 3).fill('#1e293b');
                                doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5)
                                   .text(`${currentSupplierLabel} (Cont.)`, 44, y + 5);
                                y += 26;
                            }

                            doc.rect(36, y, 523, 14).fill('#e2e8f0');
                            doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8)
                               .text(currentBranchLabel, 44, y + 3);
                            y += 16;

                            drawDetailTableHeader();

                            const sortedProducts = branchData.items.sort((a, b) => Number(a.CALCULO) - Number(b.CALCULO));

                            sortedProducts.forEach(p => {
                                if (y > 770) {
                                    doc.addPage();
                                    drawHeader();
                                    y = 85;

                                    doc.roundedRect(36, y, 523, 20, 3).fill('#1e293b');
                                    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5)
                                       .text(`${currentSupplierLabel} (Cont.)`, 44, y + 5);
                                    y += 26;

                                    doc.rect(36, y, 523, 14).fill('#e2e8f0');
                                    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8)
                                       .text(`${currentBranchLabel} (Cont.)`, 44, y + 3);
                                    y += 16;

                                    drawDetailTableHeader();
                                }

                                // Cód
                                doc.fillColor('#334155').font('Helvetica').fontSize(7.5);
                                doc.text(String(p.CODPROD), 38, y + 3, { width: 38, ellipsis: true });

                                // Descrição
                                const descText = `${p.DESCRICAO} (${p.EMBALAGEM || 'UN'} ${p.UNIDADE || ''})`;
                                doc.text(descText, 78, y + 3, { width: 148, height: 9, ellipsis: true });

                                // Est.Disp
                                const estDisp = p.ESTOQUE_DISPONIVEL !== undefined ? Number(p.ESTOQUE_DISPONIVEL) : 0;
                                if (estDisp <= 0) {
                                    doc.fillColor('#dc2626').font('Helvetica-Bold');
                                } else {
                                    doc.fillColor('#475569').font('Helvetica');
                                }
                                doc.fontSize(7.5).text(String(estDisp), 228, y + 3, { width: 42, align: 'right' });

                                // Venda/Dia
                                const vendaDia = Number(p.VENDA_DIA || 0);
                                doc.fillColor('#334155').font('Helvetica').fontSize(7.5);
                                doc.text(vendaDia.toFixed(1), 272, y + 3, { width: 40, align: 'right' });

                                // Cobertura Física
                                const cobFisica = p.COBERTURA_FISICA !== undefined ? Number(p.COBERTURA_FISICA) : 0;
                                const leadTime = Number(p.TEMPO_FORNEC || 0);
                                if (cobFisica < leadTime) {
                                    doc.fillColor('#dc2626').font('Helvetica-Bold');
                                } else {
                                    doc.fillColor('#475569').font('Helvetica');
                                }
                                doc.text(`${cobFisica.toFixed(1)}d`, 316, y + 3, { width: 42, align: 'right' });

                                // Tempo Fornecedor
                                doc.fillColor('#475569').font('Helvetica').fontSize(7.5);
                                doc.text(`${leadTime}d`, 360, y + 3, { width: 38, align: 'right' });

                                // Saldo Pedido (Sld.Ped)
                                const saldoPed = Number(p.SALDO_PEDIDO || 0);
                                if (saldoPed > 0) {
                                    doc.fillColor('#2563eb').font('Helvetica-Bold');
                                    doc.text(String(saldoPed), 400, y + 3, { width: 42, align: 'right' });
                                } else {
                                    doc.fillColor('#94a3b8').font('Helvetica');
                                    doc.text('—', 400, y + 3, { width: 42, align: 'right' });
                                }

                                // Cálculo
                                const calculo = Number(p.CALCULO || 0);
                                if (calculo < 0) {
                                    doc.fillColor('#dc2626').font('Helvetica-Bold');
                                } else if (calculo <= 5) {
                                    doc.fillColor('#f59e0b').font('Helvetica');
                                } else {
                                    doc.fillColor('#10b981').font('Helvetica');
                                }
                                doc.fontSize(7.5).text(String(calculo), 444, y + 3, { width: 34, align: 'right' });

                                // Pill de STATUS
                                const pillX = 484;
                                const pillY = y + 2;
                                const pillW = 56;
                                const pillH = 10;
                                if (isSection1) {
                                    doc.roundedRect(pillX, pillY, pillW, pillH, 3).fill('#fef2f2');
                                    doc.fillColor('#dc2626').font('Helvetica-Bold').fontSize(6);
                                    doc.text('COMPRAR', pillX + 2, pillY + 2, { width: pillW - 4, align: 'center' });
                                } else {
                                    doc.roundedRect(pillX, pillY, pillW, pillH, 3).fill('#eff6ff');
                                    doc.fillColor('#2563eb').font('Helvetica-Bold').fontSize(6);
                                    doc.text('TRÂNSITO', pillX + 2, pillY + 2, { width: pillW - 4, align: 'center' });
                                }

                                // Separador
                                doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                                y += 14;
                            });

                            y += 10;
                        });

                        y += 12;
                    });

                    y += 16;
                };

                // ===== RENDERIZAR AS SEÇÕES DETALHADAS SEPARADAS =====
                const purchaseItems = detailedData.filter(p => p.STATUS === 'CRITICO');
                const transitItems = detailedData.filter(p => p.STATUS === 'ATENCAO');

                renderSection('SEÇÃO 1: NECESSIDADE DE COMPRA (Ação Imediata)', purchaseItems, true);
                renderSection('SEÇÃO 2: PEDIDOS EM TRÂNSITO (Acompanhamento)', transitItems, false);
            }

            // ===== PAGINAÇÃO NO RODAPÉ =====
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);

                const oldBottomMargin = doc.page.margins.bottom;
                doc.page.margins.bottom = 0;

                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, 800).lineTo(559, 800).stroke();
                doc.fillColor('#475569').fontSize(8.5).font('Helvetica')
                    .text('Relatório Semanal de Compras — Brago App System', 36, 808);
                doc.text(`Página ${i + 1} de ${range.count}`, 450, 808, { align: 'right', width: 109 });

                doc.page.margins.bottom = oldBottomMargin;
            }

            doc.end();

            stream.on('finish', () => {
                resolve(pdfPath);
            });

            stream.on('error', (err) => {
                reject(err);
            });

        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Executa a rotina semanal de relatório de cobertura de compras
 * @param {boolean} dryRun Se verdadeiro, gera o PDF localmente mas não envia via WhatsApp
 * @param {string|null} testPhone Se informado, envia o Excel apenas para este número (teste)
 * @returns {Promise<Object>} Resumo da execução
 */
async function runPurchasingReport(dryRun = false, testPhone = null) {
    logger.info(`📋 Iniciando rotina de relatório de compras${dryRun ? ' (MODO DRY-RUN)' : ''}${testPhone ? ` (TESTE → ${testPhone})` : ''}...`);

    // Carrega configurações dinâmicas
    const params = {
        janelaGiro: 90,
        minDiasComVenda: 5,
        limiarAtencao: configManager.getPurchasingLimiarAtencao()
    };

    let products = [];
    try {
        products = await purchasingOracleService.getPurchasingCoverageData(params);
        logger.info(`🔍 Oracle retornou ${products.length} registros de cobertura de compras.`);
    } catch (e) {
        logger.error(`❌ Erro ao consultar cobertura de compras no Oracle: ${e.message}`);
        throw e;
    }

    // Gera o PDF e o Excel
    let pdfPath;
    let excelPath;
    try {
        pdfPath = await generatePurchasingPdf(products, dryRun);
        logger.info(`✅ PDF de compras gerado com sucesso em: ${pdfPath}`);
        
        excelPath = await purchasingExcelService.generatePurchasingExcel(products, dryRun);
        logger.info(`✅ Excel de compras gerado com sucesso em: ${excelPath}`);
    } catch (e) {
        logger.error(`❌ Erro ao gerar relatórios de compras (PDF/Excel): ${e.message}`);
        throw e;
    }

    if (dryRun) {
        logger.info('⚠️ Execução dry-run concluída. Geração local do PDF e Excel validada com sucesso.');
        return {
            success: true,
            dryRun: true,
            pdfPath,
            excelPath,
            productsCount: products.length,
            targetNumbers: []
        };
    }

    // Disparo via WhatsApp
    // Se testPhone for informado, envia apenas para ele; senão usa a lista configurada
    const targetNumbers = testPhone
        ? [testPhone]
        : configManager.getPurchasingNotifyNumbers();

    if (!testPhone && targetNumbers.length === 0) {
        logger.warn('⚠️ Nenhum número cadastrado para receber o relatório de compras.');
        return {
            success: true,
            dryRun: false,
            pdfPath,
            excelPath,
            productsCount: products.length,
            targetNumbers: [],
            sentCount: 0
        };
    }

    const dateStr = new Date().toLocaleDateString('pt-BR');
    let caption = '';

    if (testPhone) {
        caption = `🧪 *[TESTE] Relatório de Compras — ${dateStr}*\n\nPlanilha de validação enviada apenas para ${testPhone}. Dados reais, não disparado para os destinatários originais.`;
    } else if (products.length === 0) {
        caption = `📊 *Relatório Semanal de Compras — ${dateStr}*\n\nNenhum produto com desvio de cobertura detectado.`;
    } else {
        const totalCritico = products.filter(p => p.STATUS === 'CRITICO').length;
        const totalAtencao = products.filter(p => p.STATUS === 'ATENCAO').length;
        const totalSaudavel = products.filter(p => p.STATUS === 'SAUDAVEL').length;

        caption = `📊 *Relatório Semanal de Compras — ${dateStr}*\n\n` +
                  `Análise de cobertura de estoque:\n` +
                  `🔴 *A Comprar (Críticos):* ${totalCritico} item(ns)\n` +
                  `🔵 *Em Trânsito (Atenção):* ${totalAtencao} item(ns)\n` +
                  `🟢 *Saudáveis (Estoque Seguro):* ${totalSaudavel} item(ns)\n\n` +
                  `Segue em anexo a planilha Excel interativa com as sugestões de compra automáticas para auxílio nas negociações.`;
    }

    let sentCount = 0;
    for (const number of targetNumbers) {
        logger.info(`Enviando Excel de compras para ${number}...`);
        const sentExcel = await whatsapp.sendFileToNumber(number, excelPath, caption, { type: 'purchasing_excel' });
        if (sentExcel) {
            sentCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay seguro
    }

    logger.info(`📊 Envio concluído. Receberam os relatórios de compras: ${sentCount}/${targetNumbers.length}`);
    return {
        success: true,
        dryRun: false,
        pdfPath,
        excelPath,
        productsCount: products.length,
        targetNumbers,
        sentCount
    };
}

/**
 * Inicializa o agendamento cron para o envio semanal de compras
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        logger.info('⏹️ Cron anterior de compras finalizado.');
    }

    const cronTime = configManager.getPurchasingCronTime();
    logger.info(`⏰ Agendando relatório semanal de compras (cron: "${cronTime}")`);
    try {
        cronJob = new CronJob(cronTime, async () => {
            try {
                await runPurchasingReport(false);
                
                // Se o cronTime atual era de execução única temporária (ex: 17 de Junho),
                // reverte automaticamente para o agendamento regular de sexta-feira às 07:30.
                const currentCron = configManager.getPurchasingCronTime();
                if (currentCron.includes('17 06') || currentCron.includes('17 6')) {
                    logger.info('🔄 Execução única temporária concluída. Revertendo para o agendamento padrão de sexta-feira às 07:30.');
                    const currentSettings = configManager.getSettings();
                    currentSettings.purchasingCronTime = "30 07 * * 5";
                    configManager.saveSettings(currentSettings);
                    // Reinicializa o scheduler para registrar o novo cron
                    initScheduler();
                }
            } catch (err) {
                logger.error(`❌ Falha na execução agendada do relatório de compras: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');

        cronJob.start();
        logger.info('🚀 Cron job de compras inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de compras: ${e.message}`);
    }
}

module.exports = {
    generatePurchasingPdf,
    runPurchasingReport,
    initScheduler
};
