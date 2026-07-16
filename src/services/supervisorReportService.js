const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CronJob } = require('cron');
const oracleService = require('./oracleService');
const whatsapp = require('./whatsappService');
const contactsManager = require('../utils/contactsManager');
const logger = require('../utils/logger');
const configManager = require('../utils/configManager');

const LOGO_PATH = path.join(__dirname, '..', '..', 'data', 'brago_logo.png');
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

let cronJob = null;

function getLocalDateString(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Resolve os escopos de filiais e RCAs do supervisor
 */
function getSupervisorScopes(supervisor, allContacts) {
    let supervisingFiliais = supervisor.supervisingFiliais ? [...supervisor.supervisingFiliais] : [];
    let supervisingRcas = supervisor.supervisingRcas ? [...supervisor.supervisingRcas] : [];

    // Se o supervisor for Rivelino ou global
    if (supervisingFiliais.includes('ALL')) {
        supervisingFiliais = ['ALL'];
    }

    // Se tem RCAs supervisionados mas nenhuma filial definida, resolve filiais a partir dos RCAs
    if (supervisingRcas.length > 0 && supervisingFiliais.length === 0) {
        const filiais = new Set();
        supervisingRcas.forEach(rca => {
            const rcaStr = String(rca).trim();
            const seller = allContacts.find(c => 
                c.role === 'vendedor' && 
                c.rcaCode && 
                c.rcaCode.split(',').map(r => r.trim()).includes(rcaStr)
            );
            if (seller) {
                if (seller.filial === 'TODAS') {
                    filiais.add('ALL');
                } else {
                    filiais.add(String(seller.filial));
                }
            }
        });
        supervisingFiliais = Array.from(filiais);
    }
    
    return { supervisingFiliais, supervisingRcas };
}

/**
 * Obtém os cortes resolvidos hoje para o escopo do supervisor
 */
function getTodayResolvedCuts(supervisingFiliais, supervisingRcas) {
    const { getSentHistory } = require('../utils/sentTracker');
    const sentHistory = getSentHistory();
    const todayStr = getLocalDateString(new Date());

    const rawCuts = [];
    for (const msg of sentHistory) {
        const msgDate = getLocalDateString(new Date(msg.timestamp));
        if (msgDate !== todayStr) continue;

        if (msg.details && msg.details.type === 'cut_resolved') {
            rawCuts.push(msg.details);
        }
    }

    // Flatten rawCuts (supporting both new aggregated and old flat formats)
    const flatCuts = [];
    for (const c of rawCuts) {
        if (c.pedidos && Array.isArray(c.pedidos)) {
            for (const ped of c.pedidos) {
                flatCuts.push({
                    numped: ped.numped,
                    codcli: ped.codcli,
                    cliente: ped.cliente,
                    rca: c.rca,
                    nome_rca: c.nome_rca,
                    items: ped.items || [],
                    codFilial: ped.codfilial || ped.codFilial
                });
            }
        } else if (c.items && Array.isArray(c.items)) {
            flatCuts.push({
                numped: c.numped,
                codcli: c.codcli,
                cliente: c.cliente,
                rca: c.rca,
                nome_rca: c.nome_rca,
                items: c.items,
                codFilial: c.codFilial || c.codfilial
            });
        }
    }

    // Filter cuts based on supervisor scope
    const filteredCuts = [];
    for (const cut of flatCuts) {
        // Verifica se bate com os RCAs supervisionados
        let matchesRca = false;
        if (supervisingRcas && supervisingRcas.length > 0) {
            const rcaStr = String(cut.rca).trim();
            matchesRca = supervisingRcas.map(r => String(r).trim()).includes(rcaStr);
        }

        // Verifica se bate com as filiais supervisionadas (combinando 20 e 6)
        let matchesFilial = false;
        if (supervisingFiliais && supervisingFiliais.length > 0) {
            if (supervisingFiliais.includes('ALL')) {
                matchesFilial = true;
            } else {
                let filialStr = String(cut.codFilial).trim();
                if (filialStr === '6') filialStr = '20';

                const resolvedSupervising = supervisingFiliais.map(f => {
                    const s = String(f).trim();
                    return s === '6' ? '20' : s;
                });

                matchesFilial = resolvedSupervising.includes(filialStr);
            }
        }

        // Se for supervisionado por RCA ou Filial (ou ambos)
        if (matchesRca || (supervisingRcas.length === 0 && matchesFilial)) {
            filteredCuts.push(cut);
        }
    }

    return filteredCuts;
}

/**
 * Filtra produtos desbloqueados hoje para o escopo do supervisor
 */
function getFilteredProducts(products, supervisingFiliais) {
    if (!supervisingFiliais || supervisingFiliais.length === 0 || supervisingFiliais.includes('ALL')) {
        return products;
    }
    const resolvedSupervising = supervisingFiliais.map(f => {
        const s = String(f).trim();
        return s === '6' ? '20' : s;
    });
    return products.filter(p => {
        let filialStr = String(p.CODFILIAL).trim();
        if (filialStr === '6') filialStr = '20';
        return resolvedSupervising.includes(filialStr);
    });
}

/**
 * Gera o arquivo PDF customizado para o supervisor
 */
async function generateSupervisorPdf(supervisor, products, resolvedCuts) {
    const safeName = supervisor.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const pdfPath = path.join(DATA_DIR, `relatorio_supervisor_${safeName}.pdf`);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
            const stream = fs.createWriteStream(pdfPath);
            doc.pipe(stream);

            // Cabeçalho da página
            const drawHeader = () => {
                // Fundo degradê sutil
                const gradient = doc.linearGradient(0, 0, 0, 841.89);
                gradient.stop(0, '#fdfdfd').stop(1, '#f1f3f5');
                doc.rect(0, 0, 595.28, 841.89).fill(gradient);

                // Desenha a logo
                if (fs.existsSync(LOGO_PATH)) {
                    try {
                        doc.image(LOGO_PATH, 36, 25, { width: 110 });
                    } catch (e) {
                        logger.error(`Erro ao adicionar logo ao PDF: ${e.message}`);
                    }
                } else {
                    doc.fillColor('#8b5cf6').fontSize(22).font('Helvetica-Bold').text('BRAGO', 36, 30);
                }

                // Título e Metadados
                doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text('RELATÓRIO DE MONITORAMENTO DE VENDAS', 200, 30, { align: 'right' });
                const dateStr = new Date().toLocaleDateString('pt-BR');
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text(`Supervisor: ${supervisor.name} | Gerado em: ${dateStr} às ${timeStr}`, 200, 46, { align: 'right' });

                // Linha divisória roxa
                doc.strokeColor('#8b5cf6').lineWidth(1.5).moveTo(36, 62).lineTo(559, 62).stroke();
            };

            drawHeader();

            let y = 78;

            // --- KPIs ---
            const totalUnblocked = products.length;
            const totalCutsResolved = resolvedCuts.length;
            const totalOrdersAffected = new Set(resolvedCuts.map(c => c.numped)).size;

            const kpis = [
                { label: 'PRODUTOS DESBLOQUEADOS', val: totalUnblocked, sub: 'Chegadas de estoque hoje', color: '#8b5cf6' },
                { label: 'CORTES SOLUCIONADOS', val: totalCutsResolved, sub: 'Alertas disparados', color: '#10b981' },
                { label: 'PEDIDOS ATENDIDOS', val: totalOrdersAffected, sub: 'Pedidos impactados hoje', color: '#3b82f6' }
            ];

            const cardW = 160;
            const cardH = 44;
            const cardGap = 21.5;

            kpis.forEach((kpi, idx) => {
                const cardX = 36 + idx * (cardW + cardGap);
                doc.roundedRect(cardX, y, cardW, cardH, 4).fill('#ffffff');
                doc.roundedRect(cardX, y, cardW, cardH, 4).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
                doc.rect(cardX + 3, y + 6, 2.5, cardH - 12).fill(kpi.color);

                doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text(kpi.label, cardX + 12, y + 7);
                doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(String(kpi.val), cardX + 12, y + 16);
                doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica').text(kpi.sub, cardX + 12, y + 31);
            });

            y += cardH + 20;

            // --- SEÇÃO 1: ENTRADA DE MERCADORIAS (DESBLOQUEIOS) ---
            doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('ENTRADAS DE MERCADORIAS (PRODUTOS LIBERADOS)', 36, y);
            y += 14;

            const prodCols = ['Cód', 'Descrição do Produto', 'Filial', 'Qtd Chegou', 'Status'];
            const prodOffsets = [38, 85, 380, 425, 480];
            const prodWidths = [42, 290, 40, 50, 75];

            const drawProdHeader = () => {
                doc.rect(36, y, 523, 13).fill('#f8fafc');
                prodCols.forEach((text, i) => {
                    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.5);
                    doc.text(text, prodOffsets[i], y + 3, { width: prodWidths[i], ellipsis: true });
                });
                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 13).lineTo(559, y + 13).stroke();
                y += 13;
            };

            drawProdHeader();

            if (products.length === 0) {
                doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('Nenhuma entrada registrada hoje para a sua equipe.', 42, y + 4);
                doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                y += 14;
            } else {
                products.forEach(p => {
                    if (y > 750) {
                        doc.addPage();
                        drawHeader();
                        y = 75;
                        drawProdHeader();
                    }

                    const isUnlocked = p.DTDESBLOQUEIO !== null;
                    const statusText = isUnlocked ? 'Desbloqueado' : 'Retido';
                    const statusColor = isUnlocked ? '#16a34a' : '#dc2626';

                    doc.fillColor('#334155').font('Helvetica').fontSize(7.5);
                    doc.text(String(p.CODPROD), prodOffsets[0], y + 3, { width: prodWidths[0], height: 9, ellipsis: true });
                    doc.text(p.DESCRICAO || '', prodOffsets[1], y + 3, { width: prodWidths[1], height: 9, ellipsis: true });
                    doc.text(String(p.CODFILIAL), prodOffsets[2], y + 3, { width: prodWidths[2], height: 9, ellipsis: true });
                    doc.text(`${p.QT} un`, prodOffsets[3], y + 3, { width: prodWidths[3], height: 9, ellipsis: true });
                    
                    doc.fillColor(statusColor).font('Helvetica-Bold');
                    doc.text(statusText, prodOffsets[4], y + 3, { width: prodWidths[4], height: 9, ellipsis: true });

                    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 12).lineTo(559, y + 12).stroke();
                    y += 12;
                });
            }

            y += 20;

            // --- SEÇÃO 2: CORTES SUPRIDOS HOJE ---
            if (y > 700) {
                doc.addPage();
                drawHeader();
                y = 75;
            }

            doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('CORTES ATENDIDOS (ALERTAS DE ESTOQUE DISPARADOS)', 36, y);
            y += 14;

            const cutCols = ['Pedido', 'Cliente', 'Vendedor', 'Itens e Quantidades Atendidas'];
            const cutOffsets = [38, 95, 275, 410];
            const cutWidths = [52, 175, 130, 145];

            const drawCutHeader = () => {
                doc.rect(36, y, 523, 13).fill('#f8fafc');
                cutCols.forEach((text, i) => {
                    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.5);
                    doc.text(text, cutOffsets[i], y + 3, { width: cutWidths[i], ellipsis: true });
                });
                doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(36, y + 13).lineTo(559, y + 13).stroke();
                y += 13;
            };

            drawCutHeader();

            if (resolvedCuts.length === 0) {
                doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text('Nenhum corte solucionado hoje para a sua equipe.', 42, y + 4);
                doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                y += 14;
            } else {
                resolvedCuts.forEach(c => {
                    const itemSummary = c.items.map(i => `${i.codprod} (x${i.qt_falta})`).join(', ');

                    if (y > 750) {
                        doc.addPage();
                        drawHeader();
                        y = 75;
                        drawCutHeader();
                    }

                    doc.fillColor('#334155').font('Helvetica').fontSize(7.5);
                    doc.text(String(c.numped), cutOffsets[0], y + 3, { width: cutWidths[0], height: 9, ellipsis: true });
                    doc.text(`${c.codcli} - ${c.cliente}`, cutOffsets[1], y + 3, { width: cutWidths[1], height: 9, ellipsis: true });
                    doc.text(`RCA ${c.rca} - ${c.nome_rca}`, cutOffsets[2], y + 3, { width: cutWidths[2], height: 9, ellipsis: true });
                    doc.font('Helvetica-Bold').fillColor('#10b981');
                    doc.text(itemSummary, cutOffsets[3], y + 3, { width: cutWidths[3], height: 9, ellipsis: true });

                    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, y + 12).lineTo(559, y + 12).stroke();
                    y += 12;
                });
            }

            // Paginação footer
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                
                const oldBottomMargin = doc.page.margins.bottom;
                doc.page.margins.bottom = 0;

                doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(36, 800).lineTo(559, 800).stroke();
                doc.fillColor('#64748b').fontSize(8).font('Helvetica')
                    .text('Relatório Consolidado de Supervisão — Brago Monitor de Estoque', 36, 806);
                doc.text(`Página ${i + 1} de ${range.count}`, 450, 806, { align: 'right', width: 109 });

                doc.page.margins.bottom = oldBottomMargin;
            }

            doc.end();

            stream.on('finish', () => {
                resolve(pdfPath);
            });
            stream.on('error', (err) => {
                reject(err);
            });
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Envia o PDF de relatório para todos os supervisores
 * @param {boolean} force Se verdadeiro, envia mesmo se não houver dados
 */
async function sendSupervisorReports(force = false) {
    logger.info('📋 Iniciando geração dos Relatórios PDF de Supervisores...');
    
    let allContacts;
    try {
        allContacts = contactsManager.getContacts();
    } catch (e) {
        logger.error(`❌ Erro ao buscar contatos para relatórios: ${e.message}`);
        return { successCount: 0, errorCount: 0 };
    }

    const supervisors = allContacts.filter(c => c.role === 'supervisor' && c.phone);
    if (supervisors.length === 0) {
        logger.warn('⚠️ Nenhum supervisor cadastrado com telefone para receber relatórios.');
        return { successCount: 0, errorCount: 0 };
    }

    // Busca unblocks globais do dia
    let allProducts = [];
    try {
        allProducts = await oracleService.getFunnelProducts();
    } catch (e) {
        logger.error(`❌ Erro ao buscar funnel products para relatórios de supervisores: ${e.message}`);
    }

    let successCount = 0;
    let errorCount = 0;
    const dateStr = new Date().toLocaleDateString('pt-BR');

    for (const supervisor of supervisors) {
        try {
            // Resolve escopo
            const { supervisingFiliais, supervisingRcas } = getSupervisorScopes(supervisor, allContacts);

            // Filtra entradas e cortes correspondentes
            const filteredProds = getFilteredProducts(allProducts, supervisingFiliais);
            const filteredCuts = getTodayResolvedCuts(supervisingFiliais, supervisingRcas);

            if (!force && filteredProds.length === 0 && filteredCuts.length === 0) {
                logger.info(`ℹ️ Supervisor ${supervisor.name}: Sem movimentações ou cortes hoje. Envio pulado.`);
                continue;
            }

            logger.info(`📊 Gerando relatório para supervisor ${supervisor.name} (entradas: ${filteredProds.length}, cortes: ${filteredCuts.length})...`);
            
            const pdfPath = await generateSupervisorPdf(supervisor, filteredProds, filteredCuts);
            logger.info(`✅ PDF gerado para ${supervisor.name}: ${pdfPath}`);

            const caption = `📊 *Relatório Diário de Equipe — ${dateStr}*\n\nOlá, *${supervisor.name}*!\nSegue em anexo o relatório PDF consolidado sobre as entradas de mercadorias e os cortes que foram supridos hoje para a sua equipe/filiais supervisionadas.`;

            if (whatsapp.isClientReady()) {
                const targetPhone = '5561983391951';
                logger.info(`[Supervisores] [SEGURANÇA] Relatório de ${supervisor.name} seria enviado para ${supervisor.phone}. Redirecionando para Brenan Araújo (${targetPhone}).`);
                const sent = await whatsapp.sendFileToNumber(targetPhone, pdfPath, caption, {
                    type: 'supervisor_report',
                    supervisorName: supervisor.name,
                    filialScope: supervisingFiliais,
                    rcaScope: supervisingRcas,
                    realTargetPhone: supervisor.phone
                });
                if (sent) {
                    successCount++;
                    logger.info(`✅ Relatório enviado com sucesso para ${targetPhone}`);
                } else {
                    errorCount++;
                    logger.error(`❌ Falha ao enviar relatório para ${targetPhone}`);
                }
            } else {
                errorCount++;
                logger.warn(`⚠️ WhatsApp não está pronto. Relatório para ${supervisor.name} não pôde ser enviado.`);
            }

            // Intervalo entre envios
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (err) {
            errorCount++;
            logger.error(`❌ Erro ao processar relatório para supervisor ${supervisor.name}: ${err.message}`);
        }
    }

    logger.info(`📊 Relatórios de supervisores processados. Sucessos: ${successCount}, Falhas: ${errorCount}`);
    return { successCount, errorCount };
}

/**
 * Inicializa o cron diário do supervisor às 17:35 (Seg a Sex)
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const cronTime = configManager.getSupervisorCronTime();
    logger.info(`⏰ Agendando rotina diária de relatórios de supervisores (cron: "${cronTime}")`);

    try {
        cronJob = CronJob.from({
            cronTime: cronTime,
            onTick: async () => {
                logger.info('⏰ Cron do Relatório de Supervisores ativado.');
                try {
                    if (whatsapp.isClientReady()) {
                        await sendSupervisorReports(false);
                    } else {
                        logger.warn('⚠️ WhatsApp não está pronto. Envio automático de relatórios de supervisores pulado.');
                    }
                } catch (err) {
                    logger.error(`Erro ao rodar cron de relatórios de supervisores: ${err.message}`);
                }
            },
            start: true,
            timeZone: "America/Sao_Paulo"
        });

        logger.info('🚀 Cron job de relatórios de supervisores inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de relatórios de supervisores: ${e.message}`);
    }
}

module.exports = {
    sendSupervisorReports,
    generateSupervisorPdf,
    initScheduler
};
