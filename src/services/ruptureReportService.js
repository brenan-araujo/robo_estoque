const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CronJob } = require('cron');
const oracleService = require('./oracleService');
const whatsapp = require('./whatsappService');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');

const LOGO_PATH = path.join(__dirname, '..', '..', 'data', 'brago_logo.png');
const HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'rupture_history.json');
const PDF_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_rupturas.pdf');
const PDF_DRYRUN_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_rupturas_dryrun.pdf');

let cronJob = null;

/**
 * Carrega o hist\u00f3rico de rupturas
 */
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        logger.warn(`Erro ao carregar hist\u00f3rico de rupturas: ${e.message}`);
    }
    return {};
}

/**
 * Salva o hist\u00f3rico de rupturas
 */
function saveHistory(history) {
    try {
        const dir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        logger.info('\ud83d\udcbe Hist\u00f3rico de rupturas atualizado.');
    } catch (e) {
        logger.error(`Erro ao salvar hist\u00f3rico de rupturas: ${e.message}`);
    }
}

/**
 * Gera o relat\u00f3rio PDF contendo os produtos em ruptura
 * @param {Array} products Lista de produtos em ruptura
 * @param {boolean} dryRun Indica se \u00e9 uma execu\u00e7\u00e3o de teste
 * @returns {Promise<string>} Caminho do PDF gerado
 */
async function generateRupturePdf(products, dryRun = false) {
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

            const drawHeader = () => {
                // Fundo degrad\u00ea off-white premium
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

                // T\u00edtulo e metadados no topo direito
                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('RELAT\u00d3RIO DI\u00c1RIO DE RUPTURA', 220, 30, { align: 'right' });
                const dateStr = new Date().toLocaleDateString('pt-BR');
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Gerado em: ${dateStr} \u00e0s ${timeStr}${dryRun ? ' | MODO DRY-RUN' : ''}`, 220, 48, { align: 'right' });

                // Linha divis\u00f3ria Azul Royal
                doc.strokeColor('#002bf0').lineWidth(2).moveTo(36, 68).lineTo(559, 68).stroke();
            };

            drawHeader();

            let y = 85;

            if (products.length === 0) {
                // Caso n\u00e3o existam rupturas
                y = 300;
                doc.roundedRect(80, y, 435, 100, 8).fill('#ffffff');
                doc.roundedRect(80, y, 435, 100, 8).lineWidth(1).strokeColor('#cbd5e1').stroke();
                
                // Indicador lateral verde (positivo)
                doc.rect(84, y + 10, 4, 80).fill('#10b981');

                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('Estoque 100% Ativo', 105, y + 25);
                doc.fillColor('#475569').fontSize(10).font('Helvetica').text('Nenhuma ruptura de produto com giro real foi detectada hoje nas filiais monitoradas.', 105, y + 45, { width: 390 });
                doc.fillColor('#10b981').fontSize(9).font('Helvetica-Bold').text('Tudo funcionando perfeitamente!', 105, y + 65);
            } else {
                // Calcular resumos de KPIs
                const totalRuptures = products.length;
                const novasHoje = products.filter(p => (p.IDADE || 1) === 1).length;
                const cronicas = products.filter(p => (p.IDADE || 1) >= 4).length;

                // Desenha os cards de KPI no topo
                doc.roundedRect(36, y, 165, 36, 4).fill('#f8f9fa');
                doc.roundedRect(36, y, 165, 36, 4).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
                doc.fillColor('#475569').fontSize(7.5).font('Helvetica-Bold').text('TOTAL EM RUPTURA', 46, y + 8);
                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(String(totalRuptures), 46, y + 18);

                doc.roundedRect(215, y, 165, 36, 4).fill('#fff7ed');
                doc.roundedRect(215, y, 165, 36, 4).lineWidth(0.5).strokeColor('#fed7aa').stroke();
                doc.fillColor('#c2410c').fontSize(7.5).font('Helvetica-Bold').text('FALTARAM HOJE (NOVAS)', 225, y + 8);
                doc.fillColor('#ea580c').fontSize(14).font('Helvetica-Bold').text(String(novasHoje), 225, y + 18);

                doc.roundedRect(394, y, 165, 36, 4).fill('#fef2f2');
                doc.roundedRect(394, y, 165, 36, 4).lineWidth(0.5).strokeColor('#fecaca').stroke();
                doc.fillColor('#b91c1c').fontSize(7.5).font('Helvetica-Bold').text('CR\u00d4NICAS (4 DIAS+)', 404, y + 8);
                doc.fillColor('#dc2626').fontSize(14).font('Helvetica-Bold').text(String(cronicas), 404, y + 18);

                y += 48; // Desloca para começar as filiais abaixo do KPI

                // Agrupa produtos por filial
                const grouped = {};
                products.forEach(p => {
                    const fKey = String(p.CODFILIAL);
                    if (!grouped[fKey]) {
                        grouped[fKey] = {
                            nome: p.NOMEFILIAL || `Filial ${fKey}`,
                            items: []
                        };
                    }
                    grouped[fKey].items.push(p);
                });

                // Ordenar as filiais: Bras\u00edlia primeiro, depois Goi\u00e2nia, Palmas, Campo Grande
                const filialOrder = ['20', '21', '22', '23'];
                const sortedFiliais = Object.keys(grouped).sort((a, b) => {
                    const idxA = filialOrder.indexOf(a);
                    const idxB = filialOrder.indexOf(b);
                    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                    if (idxA !== -1) return -1;
                    if (idxB !== -1) return 1;
                    return a.localeCompare(b);
                });

                // Desenha cada filial
                sortedFiliais.forEach(fKey => {
                    const filialData = grouped[fKey];
                    const items = filialData.items;
                    // Ordenar os itens da filial por Fornecedor (FANTASIA) e depois por Idade (crescente: do mais novo pro mais antigo)
                    const sortedItems = items.sort((a, b) => {
                        const fornA = a.FORNECEDOR || `Cód Fornec: ${a.CODFORNEC || 'Sem Forn'}`;
                        const fornB = b.FORNECEDOR || `Cód Fornec: ${b.CODFORNEC || 'Sem Forn'}`;
                        const compForn = fornA.localeCompare(fornB);
                        if (compForn !== 0) return compForn;
                        
                        // Do mais novo pro mais antigo (IDADE crescente: 1, 2, 3...)
                        const ageA = a.IDADE || 1;
                        const ageB = b.IDADE || 1;
                        if (ageA !== ageB) return ageA - ageB;
                        
                        return Number(b.DIAS_COM_VENDA) - Number(a.DIAS_COM_VENDA);
                    });

                    // Verifica espaço mínimo para cabeçalho da filial (~80 pt)
                    if (y > 720) {
                        doc.addPage();
                        drawHeader();
                        y = 85;
                    }

                    // Título da Filial com banner
                    doc.roundedRect(36, y, 523, 20, 3).fill('#1e293b'); // Slate escuro
                    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9.5)
                       .text(`${filialData.nome.toUpperCase()} (${fKey})`, 44, y + 5);
                    y += 26;

                    // Header da Tabela Unificada
                    const drawTableTableHeader = () => {
                        doc.rect(36, y, 523, 14).fill('#f8fafc');
                        doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.5);
                        doc.text('C\u00f3d', 38, y + 3, { width: 35, ellipsis: true });
                        doc.text('Descri\u00e7\u00e3o / Embalagem / Unidade', 78, y + 3, { width: 255, ellipsis: true });
                        doc.text('Giro 90d', 340, y + 3, { width: 45, align: 'right' });
                        doc.text('Est. Disp.', 390, y + 3, { width: 45, align: 'right' });
                        doc.text('Saldo', 440, y + 3, { width: 65, align: 'right' });
                        doc.text('Idade', 510, y + 3, { width: 45, align: 'right' });
                        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                        y += 14;
                    };

                    drawTableTableHeader();

                    let currentForn = '';

                    sortedItems.forEach(p => {
                        const fornKey = p.FORNECEDOR 
                            ? `${p.FORNECEDOR.toUpperCase()} (${p.CODFORNEC})` 
                            : `FORNECEDOR N\u00c3O INFORMADO (${p.CODFORNEC || 'S/C'})`;

                        // Se mudar de fornecedor, desenha a barra separadora do fornecedor
                        if (fornKey !== currentForn) {
                            currentForn = fornKey;
                            
                            // Verifica se há espaço para a barra de fornecedor + pelo menos uma linha de produto (~30 pt)
                            if (y > 760) {
                                doc.addPage();
                                drawHeader();
                                y = 85;
                                drawTableTableHeader();
                            }

                            doc.rect(36, y, 523, 14).fill('#e2e8f0');
                            doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(7.5);
                            doc.text(`FORNECEDOR: ${currentForn}`, 44, y + 3);
                            doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                            y += 14;
                        }

                        // Verifica espaço para o produto
                        if (y > 770) {
                            doc.addPage();
                            drawHeader();
                            y = 85;
                            drawTableTableHeader();
                            
                            // Repete a barra de fornecedor se a lista quebrou
                            doc.rect(36, y, 523, 14).fill('#e2e8f0');
                            doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(7.5);
                            doc.text(`FORNECEDOR: ${currentForn} (Cont.)`, 44, y + 3);
                            doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                            y += 14;
                        }

                        const isAltoGiro = Number(p.DIAS_COM_VENDA) >= 40;
                        const descText = `${p.DESCRICAO} (${p.EMBALAGEM || 'UN'} ${p.UNIDADE || ''})${isAltoGiro ? ' *' : ''}`;

                        doc.fillColor('#334155').font('Helvetica').fontSize(8);
                        doc.text(String(p.CODPROD), 38, y + 3, { width: 35, ellipsis: true });
                        doc.text(descText, 78, y + 3, { width: 255, height: 9, ellipsis: true });

                        // Giro 90d destacado se for alto giro
                        if (isAltoGiro) {
                            doc.fillColor('#dc2626').font('Helvetica-Bold');
                        } else {
                            doc.fillColor('#334155').font('Helvetica');
                        }
                        doc.text(`${p.DIAS_COM_VENDA}d`, 340, y + 3, { width: 45, align: 'right' });

                        // Estoque Disponível (EstDisp) - Mesmo sendo zero ou negativo
                        const estDisp = p.ESTOQUE_DISP !== undefined ? Number(p.ESTOQUE_DISP) : 0;
                        if (estDisp < 0) {
                            doc.fillColor('#dc2626').font('Helvetica-Bold'); // Vermelho se negativo
                        } else {
                            doc.fillColor('#475569').font('Helvetica');
                        }
                        doc.text(String(estDisp), 390, y + 3, { width: 45, align: 'right' });

                        // Saldo (O que tem pra chegar)
                        const pendingPo = Number(p.QT_PEDIDA_ABERTO || 0);
                        if (pendingPo > 0) {
                            doc.fillColor('#2563eb').font('Helvetica-Bold');
                            doc.text(`${pendingPo} ${p.UNIDADE || 'un'}`, 440, y + 3, { width: 65, align: 'right' });
                        } else {
                            doc.fillColor('#64748b').font('Helvetica');
                            doc.text('\u2014', 440, y + 3, { width: 65, align: 'right' });
                        }

                        // Idade da ruptura colorida por semáforo
                        const idade = p.IDADE || 1;
                        const idadeStr = idade === 1 ? 'Hoje' : `${idade}d`;
                        let colorIdade = '#dc2626';
                        if (idade === 1) {
                            colorIdade = '#ea580c'; // Coral para hoje
                        } else if (idade >= 4) {
                            colorIdade = '#991b1b'; // Vermelho escuro para crônicos
                        }
                        doc.fillColor(colorIdade).font('Helvetica-Bold').text(idadeStr, 510, y + 3, { width: 45, align: 'right' });

                        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                        y += 14;
                    });

                    y += 12; // Espaço extra após a filial
                    y += 10; // Espaço extra entre filiais
                });
            }

            // Pagina\u00e7\u00e3o no rodap\u00e9
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                
                const oldBottomMargin = doc.page.margins.bottom;
                doc.page.margins.bottom = 0;

                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, 800).lineTo(559, 800).stroke();
                doc.fillColor('#475569').fontSize(8.5).font('Helvetica')
                    .text('Relat\u00f3rio Di\u00e1rio de Ruptura de Estoque (Produtos com Giro) \u2014 Brago App System', 36, 808);
                doc.text(`P\u00e1gina ${i + 1} de ${range.count}`, 450, 808, { align: 'right', width: 109 });

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
 * Executa a rotina di\u00e1ria de ruptura de estoque
 * @param {boolean} dryRun Se verdadeiro, gera o PDF localmente mas n\u00e3o atualiza o hist\u00f3rico real nem envia via WhatsApp
 * @returns {Promise<Object>} Resumo da execu\u00e7\u00e3o
 */
async function runRuptureReport(dryRun = false) {
    logger.info(`\ud83d\udccb Iniciando rotina de ruptura de estoque${dryRun ? ' (MODO DRY-RUN)' : ''}...`);

    // Carrega configura\u00e7\u00f5es din\u00e2micas
    const params = {
        pisoEstoque: configManager.getRupturePisoEstoque(),
        janelaGiro: configManager.getRuptureJanelaGiro(),
        minDiasComVenda: configManager.getRuptureMinDiasComVenda(),
        janelaVendaRecente: configManager.getRuptureJanelaVendaRecente()
    };

    let products = [];
    try {
        products = await oracleService.getRuptureProducts(params);
        logger.info(`\ud83d\udd0d Oracle retornou ${products.length} registros em ruptura de estoque.`);
    } catch (e) {
        logger.error(`\u274c Erro ao consultar rupturas no Oracle: ${e.message}`);
        throw e;
    }

    // Gerencia o histórico e atribui a IDADE da ruptura
    const oldHistory = loadHistory();
    const newHistory = {};
    const todayStr = new Date().toISOString().split('T')[0];

    if (products.length > 0) {
        products.forEach(p => {
            const key = `${p.CODFILIAL}-${p.CODPROD}`;
            
            let firstSeen = todayStr;
            if (oldHistory[key] && oldHistory[key].dateFirstSeen) {
                firstSeen = oldHistory[key].dateFirstSeen;
            }
            
            const diffTime = new Date(todayStr) - new Date(firstSeen);
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            p.IDADE = diffDays + 1;
            
            newHistory[key] = {
                dateFirstSeen: firstSeen
            };
        });
    }

    // Salva o hist\u00f3rico apenas se N\u00c3O for dryRun
    if (!dryRun) {
        // Para chaves que estavam em ruptura ontem mas sa\u00edram hoje, n\u00e3o as inclu\u00edmos no newHistory, o que efetivamente as "limpa"
        saveHistory(newHistory);
    }

    // Gera o PDF
    let pdfPath;
    try {
        pdfPath = await generateRupturePdf(products, dryRun);
        logger.info(`\u2705 PDF de rupturas gerado com sucesso em: ${pdfPath}`);
    } catch (e) {
        logger.error(`\u274c Erro ao gerar PDF de rupturas: ${e.message}`);
        throw e;
    }

    if (dryRun) {
        logger.info('\u26a0\ufe0f Execu\u00e7\u00e3o dry-run conclu\u00edda. Gera\u00e7\u00e3o local do PDF validada com sucesso.');
        return {
            success: true,
            dryRun: true,
            pdfPath,
            productsCount: products.length,
            targetNumbers: []
        };
    }

    // Disparo via WhatsApp
    const targetNumbers = configManager.getRuptureNotifyNumbers();
    if (targetNumbers.length === 0) {
        logger.warn('\u26a0\ufe0f Nenhum n\u00famero cadastrado para receber o relat\u00f3rio de rupturas.');
        return {
            success: true,
            dryRun: false,
            pdfPath,
            productsCount: products.length,
            targetNumbers: [],
            sentCount: 0
        };
    }

    const dateStr = new Date().toLocaleDateString('pt-BR');
    let caption = '';
    
    if (products.length === 0) {
        caption = `\ud83d\udcca *Relat\u00f3rio de Ruptura de Estoque \u2014 ${dateStr}*\n\nNenhuma ruptura de produtos com giro ativo detectada hoje.`;
    } else {
        const totalCriticas = products.filter(p => Number(p.QT_PEDIDA_ABERTO) <= 0).length;
        const totalAguardando = products.filter(p => Number(p.QT_PEDIDA_ABERTO) > 0).length;
        
        caption = `\ud83d\udcca *Relat\u00f3rio Di\u00e1rio de Ruptura de Estoque \u2014 ${dateStr}*\n\n` +
                  `Detectamos rupturas de produtos com giro ativo:\n` +
                  `\u2022 *Rupturas Cr\u00edticas (Sem Compra):* ${totalCriticas} item(ns)\n` +
                  `\u2022 *Aguardando Entrega (Com Compra):* ${totalAguardando} item(ns)\n\n` +
                  `Segue em anexo o relat\u00f3rio PDF detalhado dividido por Filial.`;
    }

    let sentCount = 0;
    for (const number of targetNumbers) {
        logger.info(`Enviando PDF de rupturas para ${number}...`);
        const sent = await whatsapp.sendFileToNumber(number, pdfPath, caption, { type: 'rupture_pdf' });
        if (sent) {
            sentCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay seguro
    }

    logger.info(`\ud83d\udcca Envio conclu\u00eddo. Receberam o PDF de rupturas: ${sentCount}/${targetNumbers.length}`);
    return {
        success: true,
        dryRun: false,
        pdfPath,
        productsCount: products.length,
        targetNumbers,
        sentCount
    };
}

/**
 * Inicializa o agendamento cron para o envio di\u00e1rio
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        logger.info('\u23f9\ufe0f Cron anterior de rupturas finalizado.');
    }

    const cronTime = configManager.getRuptureCronTime();
    logger.info(`\u23f0 Agendando rotina di\u00e1ria de rupturas (cron: "${cronTime}")`);

    try {
        cronJob = new CronJob(cronTime, async () => {
            try {
                await runRuptureReport(false);
            } catch (err) {
                logger.error(`\u274c Falha na execu\u00e7\u00e3o agendada do relat\u00f3rio de rupturas: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');
        
        cronJob.start();
        logger.info('\ud83d\ude80 Cron job de rupturas inicializado com sucesso.');
    } catch (e) {
        logger.error(`\u274c Erro ao criar cron job de rupturas: ${e.message}`);
    }
}

module.exports = {
    generateRupturePdf,
    runRuptureReport,
    initScheduler,
    loadHistory
};
