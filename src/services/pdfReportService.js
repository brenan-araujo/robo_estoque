const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CronJob } = require('cron');
const oracleService = require('./oracleService');
const whatsapp = require('./whatsappService');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');

// Caminho do logo e diretório temporário para o PDF
const LOGO_PATH = path.join(__dirname, '..', '..', 'data', 'brago_logo.png');
const PDF_TEMP_PATH = path.join(__dirname, '..', '..', 'data', 'resumo_diario.pdf');

let cronJob = null;

/**
 * Gera o relatório PDF contendo o resumo e funil de conversão
 * @param {Array|null} products Lista de produtos já consultados (opcional)
 * @returns {Promise<string>} Caminho do arquivo PDF gerado
 */
async function generateDailyPdf(products = null) {
    return new Promise(async (resolve, reject) => {
        try {
            // 1. Busca dados do funil do dia de hoje se não fornecido
            if (!products) {
                products = await oracleService.getFunnelProducts();
            }

            // 2. Classifica os produtos
            const totalArrived = products.length;

            const filteredProducts = products.filter(p => {
                const estAnterior = p.QTDISP - p.QT;
                return p.TEM_PENDENCIA === 'S' || estAnterior <= 0;
            });
            const totalFiltered = filteredProducts.length;

            const unlockedProducts = products.filter(p => p.DTDESBLOQUEIO !== null);
            const totalUnlocked = unlockedProducts.length;

            // 3. Inicializa o documento PDFKit
            const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
            const stream = fs.createWriteStream(PDF_TEMP_PATH);
            doc.pipe(stream);

            // Cabeçalho da página
            const drawHeader = () => {
                // Desenha fundo degradê off-white
                const gradient = doc.linearGradient(0, 0, 0, 841.89);
                gradient.stop(0, '#f8f9fa')   // Off-White
                        .stop(1, '#edf0f2');  // Soft Light Gray
                doc.rect(0, 0, 595.28, 841.89).fill(gradient);

                // Desenha a logo se existir
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
                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('RESUMO DIÁRIO DE MOVIMENTAÇÃO', 220, 30, { align: 'right' });
                const dateStr = new Date().toLocaleDateString('pt-BR');
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                doc.fillColor('#475569').fontSize(9.5).font('Helvetica').text(`Gerado em: ${dateStr} às ${timeStr} | Canal: WhatsApp`, 220, 48, { align: 'right' });

                // Linha divisória Azul Royal (combinando com a logo)
                doc.strokeColor('#002bf0').lineWidth(2).moveTo(36, 68).lineTo(559, 68).stroke();
            };

            drawHeader();

            let y = 80;

            // --- DESENHO DOS KPIS ---
            const pctFiltered = totalArrived > 0 ? ((totalFiltered / totalArrived) * 100).toFixed(0) : 0;
            const pctUnlocked = totalArrived > 0 ? ((totalUnlocked / totalArrived) * 100).toFixed(0) : 0;

            const kpis = [
                { label: 'RECEBIDOS', val: totalArrived, sub: 'Entradas de hoje', color: '#8b5cf6' },
                { label: 'RETIDOS', val: totalFiltered, sub: `${pctFiltered}% do total`, color: '#ea580c' },
                { label: 'DESBLOQUEADOS', val: totalUnlocked, sub: `${pctUnlocked}% de conversão`, color: '#10b981' }
            ];

            const cardW = 160;
            const cardH = 46;
            const cardGap = 21.5;

            kpis.forEach((kpi, idx) => {
                const cardX = 36 + idx * (cardW + cardGap);
                // Background branco
                doc.roundedRect(cardX, y, cardW, cardH, 5).fill('#ffffff');
                // Borda cinza clara
                doc.roundedRect(cardX, y, cardW, cardH, 5).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
                // Indicador lateral
                doc.rect(cardX + 4, y + 8, 3, cardH - 16).fill(kpi.color);
                
                // Textos do KPI
                doc.fillColor('#64748b').fontSize(7.5).font('Helvetica-Bold').text(kpi.label, cardX + 13, y + 8);
                doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text(String(kpi.val), cardX + 13, y + 17);
                doc.fillColor('#64748b').fontSize(7).font('Helvetica').text(kpi.sub, cardX + 13, y + 33);
            });

            y += cardH + 14; // Y fica em 140

            // --- TÍTULOS DOS GRÁFICOS ---
            doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('FLUXO DO FUNIL', 36, y);
            doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('DESEMPENHO POR FILIAL (TOP 4)', 290, y);
            y += 15; // Y fica em 155

            // --- GRÁFICO 1: FUNIL VETORIAL ---
            const funnelCenter = 153;
            // Estágio 1
            const grad1 = doc.linearGradient(funnelCenter - 90, y, funnelCenter + 90, y + 25);
            grad1.stop(0, '#8b5cf6').stop(1, '#a78bfa');
            doc.moveTo(funnelCenter - 90, y)
               .lineTo(funnelCenter + 90, y)
               .lineTo(funnelCenter + 70, y + 25)
               .lineTo(funnelCenter - 70, y + 25)
               .closePath()
               .fill(grad1);
            doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold')
               .text(`Recebidos: ${totalArrived}`, funnelCenter - 90, y + 8, { align: 'center', width: 180 });

            // Conector 1 -> 2
            doc.fillColor('#94a3b8');
            doc.moveTo(funnelCenter - 3, y + 27)
               .lineTo(funnelCenter + 3, y + 27)
               .lineTo(funnelCenter, y + 31)
               .closePath()
               .fill();

            // Estágio 2
            const grad2 = doc.linearGradient(funnelCenter - 65, y + 34, funnelCenter + 65, y + 59);
            grad2.stop(0, '#ea580c').stop(1, '#f97316');
            doc.moveTo(funnelCenter - 65, y + 34)
               .lineTo(funnelCenter + 65, y + 34)
               .lineTo(funnelCenter + 50, y + 59)
               .lineTo(funnelCenter - 50, y + 59)
               .closePath()
               .fill(grad2);
            doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold')
               .text(`Retidos: ${totalFiltered}`, funnelCenter - 65, y + 42, { align: 'center', width: 130 });

            // Conector 2 -> 3
            doc.fillColor('#94a3b8');
            doc.moveTo(funnelCenter - 3, y + 61)
               .lineTo(funnelCenter + 3, y + 61)
               .lineTo(funnelCenter, y + 65)
               .closePath()
               .fill();

            // Estágio 3
            const grad3 = doc.linearGradient(funnelCenter - 45, y + 68, funnelCenter + 45, y + 93);
            grad3.stop(0, '#10b981').stop(1, '#34d399');
            doc.moveTo(funnelCenter - 45, y + 68)
               .lineTo(funnelCenter + 45, y + 68)
               .lineTo(funnelCenter + 35, y + 93)
               .lineTo(funnelCenter - 35, y + 93)
               .closePath()
               .fill(grad3);
            doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold')
               .text(`Liberados: ${totalUnlocked}`, funnelCenter - 45, y + 76, { align: 'center', width: 90 });

            // --- GRÁFICO 2: EFICIÊNCIA POR FILIAL ---
            const branchMap = {};
            products.forEach(p => {
                const b = p.CODFILIAL || 'N/A';
                if (!branchMap[b]) {
                    branchMap[b] = { arrived: 0, unlocked: 0, blocked: 0 };
                }
                branchMap[b].arrived++;
                if (p.DTDESBLOQUEIO !== null) {
                    branchMap[b].unlocked++;
                } else if (p.TEM_PENDENCIA === 'S' || (p.QTDISP - p.QT) <= 0) {
                    branchMap[b].blocked++;
                }
            });

            const branchList = Object.keys(branchMap).map(key => ({
                filial: key,
                ...branchMap[key]
            })).sort((a, b) => b.arrived - a.arrived);

            const topBranches = branchList.slice(0, 4);

            topBranches.forEach((branch, idx) => {
                const bY = y + (idx * 24);
                const pct = branch.arrived > 0 ? ((branch.unlocked / branch.arrived) * 100).toFixed(0) : 0;
                
                doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text(`Filial ${branch.filial}`, 290, bY);
                doc.fillColor('#475569').fontSize(7.5).font('Helvetica').text(`${branch.unlocked}/${branch.arrived} lib. (${pct}%)`, 450, bY, { align: 'right', width: 109 });
                
                // Barra de fundo (Slate 200)
                doc.roundedRect(290, bY + 10, 269, 5, 2.5).fill('#e2e8f0');
                
                // Barra de progresso da liberação (verde)
                const progressW = branch.arrived > 0 ? (branch.unlocked / branch.arrived) * 269 : 0;
                if (progressW > 0) {
                    doc.roundedRect(290, bY + 10, progressW, 5, 2.5).fill('#10b981');
                }
            });

            y = 285;

            // Seção de Detalhamento
            doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('DETALHAMENTO DOS PRODUTOS RECEBIDOS HOJE', 36, y);
            y += 15;

            // TABELA AGRUPADA POR NOTA FISCAL
            const tableCols = ['Cód', 'Descrição', 'Qtd', 'Status Atual'];
            const tableOffsets = [38, 85, 400, 450];
            const tableWidths = [40, 310, 45, 105];

            const drawTableHeader = () => {
                doc.rect(36, y, 523, 14).fill('#f1f5f9');
                tableCols.forEach((text, i) => {
                    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.5);
                    doc.text(text, tableOffsets[i], y + 3, { width: tableWidths[i], height: 9, ellipsis: true });
                });
                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                y += 14;
            };

            if (totalArrived === 0) {
                drawTableHeader();
                doc.fillColor('#64748b').font('Helvetica').fontSize(8.5).text('Nenhum produto recebido hoje.', 38, y + 4);
                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                y += 14;
            } else {
                // Agrupa produtos por nota
                const groupedByNota = {};
                products.forEach(p => {
                    const nota = p.NUMNOTA || 'Sem Nota';
                    if (!groupedByNota[nota]) {
                        groupedByNota[nota] = [];
                    }
                    groupedByNota[nota].push(p);
                });

                // Calcula score para ordenação dos grupos: Notas com produtos Bloqueados no topo!
                const groupScores = {};
                Object.keys(groupedByNota).forEach(nota => {
                    const groupProducts = groupedByNota[nota];
                    const hasBlocked = groupProducts.some(p => p.DTDESBLOQUEIO === null && (p.TEM_PENDENCIA === 'S' || (p.QTDISP - p.QT) <= 0));
                    const allUnlocked = groupProducts.every(p => p.DTDESBLOQUEIO !== null);
                    if (hasBlocked) {
                        groupScores[nota] = 3;
                    } else if (!allUnlocked) {
                        groupScores[nota] = 2;
                    } else {
                        groupScores[nota] = 1;
                    }
                });

                const sortedNotas = Object.keys(groupedByNota).sort((a, b) => {
                    const scoreA = groupScores[a];
                    const scoreB = groupScores[b];
                    if (scoreA !== scoreB) {
                        return scoreB - scoreA;
                    }
                    return b - a;
                });

                // Renderiza cada grupo de nota
                sortedNotas.forEach(nota => {
                    const groupProducts = groupedByNota[nota];
                    
                    // Ordena os produtos de cada nota: Bloqueados primeiro
                    const sortedGroupProducts = [...groupProducts].sort((a, b) => {
                        const aIsUnlocked = a.DTDESBLOQUEIO !== null;
                        const bIsUnlocked = b.DTDESBLOQUEIO !== null;
                        const aIsFiltered = a.TEM_PENDENCIA === 'S' || (a.QTDISP - a.QT) <= 0;
                        const bIsFiltered = b.TEM_PENDENCIA === 'S' || (b.QTDISP - b.QT) <= 0;
                        
                        const getScore = (p, isFiltered, isUnlocked) => {
                            if (isUnlocked) return 2;
                            if (isFiltered) return 3;
                            return 1;
                        };
                        
                        return getScore(b, bIsFiltered, bIsUnlocked) - getScore(a, aIsFiltered, aIsUnlocked);
                    });

                    // Verifica se há espaço suficiente antes de desenhar o banner e o header (mínimo de ~50 pt)
                    if (y > 700) {
                        doc.addPage();
                        drawHeader();
                        y = 85;
                    }

                    const firstProduct = sortedGroupProducts[0];
                    const filial = firstProduct.CODFILIAL || 'N/A';
                    const fornecedor = firstProduct.FORNECEDOR || 'N/A';

                    // Desenha banner da nota fiscal
                    doc.roundedRect(36, y, 523, 16, 2).fill('#e2e8f0');
                    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8)
                       .text(`NOTA FISCAL: ${nota}  |  FILIAL: ${filial}  |  FORNECEDOR: ${fornecedor}`, 42, y + 4, { width: 511, ellipsis: true });
                    y += 18;

                    // Desenha cabeçalho da tabela desta nota
                    drawTableHeader();

                    // Desenha as linhas dos produtos
                    sortedGroupProducts.forEach(p => {
                        if (y > 750) {
                            doc.addPage();
                            drawHeader();
                            y = 85;
                            // Redesenha o banner e cabeçalho na nova página para indicar continuidade
                            doc.roundedRect(36, y, 523, 16, 2).fill('#e2e8f0');
                            doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8)
                               .text(`NOTA FISCAL: ${nota} (Cont.)  |  FILIAL: ${filial}  |  FORNECEDOR: ${fornecedor}`, 42, y + 4, { width: 511, ellipsis: true });
                            y += 18;
                            drawTableHeader();
                        }

                        const isUnlocked = p.DTDESBLOQUEIO !== null;
                        const isFiltered = p.TEM_PENDENCIA === 'S' || (p.QTDISP - p.QT) <= 0;

                        let statusText = '';
                        let statusColor = '';

                        if (isUnlocked) {
                            const hora = new Date(p.DTDESBLOQUEIO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                            statusText = `Liberado (${hora})`;
                            statusColor = '#16a34a';
                        } else if (isFiltered) {
                            const estAnterior = p.QTDISP - p.QT;
                            const reasons = [];
                            if (estAnterior <= 0) reasons.push('Estoque 0');
                            if (p.TEM_PENDENCIA === 'S') reasons.push('Pendente');
                            statusText = `Bloqueado (${reasons.join('/')})`;
                            statusColor = '#dc2626';
                        } else {
                            statusText = 'Liberado Direto';
                            statusColor = '#475569';
                        }

                        doc.fillColor('#334155').font('Helvetica').fontSize(8);
                        doc.text(String(p.CODPROD), tableOffsets[0], y + 3, { width: tableWidths[0], height: 9, ellipsis: true });
                        const dateStr = p.DTMOV ? (p.DTMOV instanceof Date ? p.DTMOV.toLocaleDateString('pt-BR') : new Date(p.DTMOV).toLocaleDateString('pt-BR')) : '';
                        const descWithDate = p.DESCRICAO ? `${p.DESCRICAO} (${dateStr})` : '';
                        doc.text(descWithDate || '', tableOffsets[1], y + 3, { width: tableWidths[1], height: 9, ellipsis: true });
                        doc.text(`${p.QT} un`, tableOffsets[2], y + 3, { width: tableWidths[2], height: 9, ellipsis: true });
                        
                        doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(8);
                        doc.text(statusText, tableOffsets[3], y + 3, { width: tableWidths[3], height: 9, ellipsis: true });

                        // Linha divisória
                        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                        y += 14;
                    });

                    // Espaçamento entre notas fiscais
                    y += 10;
                });
            }

            // Adiciona rodapé de paginação em todas as páginas
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                
                // Salva margem de baixo e zera temporariamente para evitar quebras automáticas indesejadas no rodapé
                const oldBottomMargin = doc.page.margins.bottom;
                doc.page.margins.bottom = 0;

                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, 800).lineTo(559, 800).stroke();
                doc.fillColor('#475569').fontSize(8.5).font('Helvetica')
                    .text('Relatório de Jornada de Entrada de Mercadorias — Brago App System', 36, 808);
                doc.text(`Página ${i + 1} de ${range.count}`, 450, 808, { align: 'right', width: 109 });

                // Restaura a margem de baixo
                doc.page.margins.bottom = oldBottomMargin;
            }

            // Finaliza gravação do arquivo
            doc.end();

            stream.on('finish', () => {
                resolve(PDF_TEMP_PATH);
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
 * Envia o PDF para a lista de contatos do PDF diário
 * @param {boolean} force Se verdadeiro, ignora a verificação de movimentações
 * @returns {Promise<{successCount: number, errorCount: number, skipped?: boolean}>}
 */
async function sendDailyPdfReport(force = false) {
    logger.info('📋 Iniciando geração do Relatório PDF Diário de Estoque...');
    
    let products;
    try {
        products = await oracleService.getFunnelProducts();
    } catch (e) {
        logger.error(`❌ Erro ao buscar produtos para o PDF: ${e.message}`);
        throw e;
    }

    if (!force && products.length === 0) {
        logger.info('⚠️ Nenhuma movimentação registrada hoje. O envio do PDF diário foi pulado.');
        return { successCount: 0, errorCount: 0, skipped: true };
    }

    let pdfPath;
    try {
        pdfPath = await generateDailyPdf(products);
        logger.info(`✅ PDF gerado com sucesso em: ${pdfPath}`);
    } catch (e) {
        logger.error(`❌ Falha ao gerar PDF de Resumo Diário: ${e.message}`);
        throw e;
    }

    const numbers = configManager.getPdfNotifyNumbers();
    if (numbers.length === 0) {
        logger.warn('⚠️ Nenhum número cadastrado para receber o PDF diário.');
        return { successCount: 0, errorCount: 0 };
    }

    let successCount = 0;
    let errorCount = 0;

    const dateStr = new Date().toLocaleDateString('pt-BR');
    const caption = `📊 *Resumo Diário de Entrada de Mercadorias — ${dateStr}*\n\nSegue em anexo o relatório PDF consolidando o funil de produtos recebidos, retidos e desbloqueados hoje.`;

    for (const number of numbers) {
        logger.info(`Enviando PDF de resumo para ${number}...`);
        const sent = await whatsapp.sendFileToNumber(number, pdfPath, caption, { type: 'daily_pdf' });
        if (sent) {
            successCount++;
        } else {
            errorCount++;
        }
        // Delay para evitar envio massivo rápido
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info(`📊 Relatório PDF enviado. Sucessos: ${successCount}, Falhas: ${errorCount}`);
    return { successCount, errorCount };
}

/**
 * Inicializa o agendamento cron diário
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const cronTime = configManager.getPdfCronTime();
    logger.info(`⏰ Agendando rotina diária de resumo PDF (cron: "${cronTime}")`);

    try {
        cronJob = CronJob.from({
            cronTime: cronTime,
            onTick: async () => {
                logger.info('⏰ Cron do Resumo Diário PDF ativado.');
                try {
                    if (whatsapp.isClientReady()) {
                        await sendDailyPdfReport(false);
                    } else {
                        logger.warn('⚠️ WhatsApp não está pronto. Envio automático do PDF diário pulado.');
                    }
                } catch (err) {
                    logger.error(`Erro ao rodar cron de relatório diário: ${err.message}`);
                }
            },
            start: true,
            timeZone: "America/Sao_Paulo"
        });

        logger.info('🚀 Cron job de resumo diário PDF inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de resumo diário: ${e.message}`);
    }
}

module.exports = {
    generateDailyPdf,
    sendDailyPdfReport,
    initScheduler
};
