const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CronJob } = require('cron');
const salesOracleService = require('./salesOracleService');
const whatsapp = require('./whatsappService');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');

const LOGO_PATH = path.join(__dirname, '..', '..', 'data', 'brago_logo.png');
const PDF_TEMP_PATH = path.join(__dirname, '..', '..', 'data', 'resumo_vendas.pdf');

let cronJob = null;

// ─── Helpers ────────────────────────────────────────────

function fmtBRL(value) {
    const formatted = Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return formatted.replace(/\s/g, '\u00A0');
}

function fmtBRLCompact(value) {
    const formatted = Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    return formatted.replace(/\s/g, '\u00A0');
}

function fmtNum(value) {
    return Number(value || 0).toLocaleString('pt-BR');
}

function fmtPct(value, decimals = 1) {
    return `${Number(value || 0).toFixed(decimals)}%`;
}

function truncText(text, maxLen) {
    if (!text) return '';
    return text.length > maxLen ? text.substring(0, maxLen - 1) + '…' : text;
}

// Cores do design
const COLORS = {
    bg1: '#f8f9fa',
    bg2: '#edf0f2',
    brand: '#002bf0',
    textDark: '#0f172a',
    textMuted: '#475569',
    textLight: '#64748b',
    cardBg: '#ffffff',
    cardBorder: '#cbd5e1',
    divider: '#e2e8f0',
    purple: '#8b5cf6',
    orange: '#ea580c',
    sky: '#0ea5e9',
    green: '#10b981',
    emerald: '#059669',
    red: '#ef4444',
    amber: '#f59e0b',
    rose: '#f43f5e',
    indigo: '#6366f1',
    cyan: '#06b6d4',
    teal: '#14b8a6',
};

// Paleta para gráficos de pizza/departamento
const PIE_COLORS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

// ─── PDF Generation ─────────────────────────────────────

/**
 * Gera o relatório PDF de vendas
 * @param {Object|null} data Dados de vendas já coletados (opcional)
 * @returns {Promise<string>} Caminho do arquivo PDF gerado
 */
async function generateSalesPdf(data = null) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!data) {
                data = await salesOracleService.getFullSalesReport();
            }

            const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
            const stream = fs.createWriteStream(PDF_TEMP_PATH);
            doc.pipe(stream);

            // ─── Header ──────────────────────────────
            const drawHeader = () => {
                // Fundo degradê
                const gradient = doc.linearGradient(0, 0, 0, 841.89);
                gradient.stop(0, COLORS.bg1).stop(1, COLORS.bg2);
                doc.rect(0, 0, 595.28, 841.89).fill(gradient);

                // Barra superior decorativa (azul royal)
                const topBar = doc.linearGradient(0, 0, 595.28, 0);
                topBar.stop(0, '#002bf0').stop(1, '#4f6ef7');
                doc.rect(0, 0, 595.28, 4).fill(topBar);

                // Logo
                if (fs.existsSync(LOGO_PATH)) {
                    try { doc.image(LOGO_PATH, 36, 14, { width: 120 }); } catch (e) { 
                        doc.fillColor(COLORS.brand).fontSize(22).font('Helvetica-Bold').text('BRAGO', 36, 18);
                    }
                } else {
                    doc.fillColor(COLORS.brand).fontSize(22).font('Helvetica-Bold').text('BRAGO', 36, 18);
                }

                // Título
                doc.fillColor(COLORS.textDark).fontSize(15).font('Helvetica-Bold')
                   .text('RELATÓRIO DE VENDAS DIÁRIO', 200, 16, { align: 'right' });
                const rDate = data && data.targetDate ? new Date(data.targetDate) : new Date();
                const dateStr = rDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                doc.fillColor(COLORS.textMuted).fontSize(8.5).font('Helvetica')
                   .text(`Referente a: ${dateStr} | Gerado em: ${timeStr}`, 200, 34, { align: 'right' });

                // Linha divisória com gradiente
                doc.strokeColor(COLORS.brand).lineWidth(2).moveTo(36, 52).lineTo(559, 52).stroke();
                doc.strokeColor(COLORS.divider).lineWidth(0.5).moveTo(36, 54).lineTo(559, 54).stroke();
            };

            drawHeader();
            let y = 64;

            // ─── SEÇÃO 1: KPIs PRINCIPAIS ────────────
            const kpiW = 124;
            const kpiH = 56;
            const kpiGap = 8;

            const pctMetaDia = data.meta.metaDia > 0 ? (data.dia.vendas / data.meta.metaDia) * 100 : 0;
            const pctPosDia = data.positivacao.baseAtiva > 0 ? (data.positivacao.hoje / data.positivacao.baseAtiva) * 100 : 0;

            const kpis = [
                { label: 'VENDAS DO DIA', value: fmtBRL(data.dia.vendas), sub: `Bruto: ${fmtBRLCompact(data.dia.vendasBruta)} | Dev: ${fmtBRLCompact(data.dia.devolucoes)}`, color: COLORS.purple, icon: '💰' },
                { label: 'META DO DIA', value: fmtPct(pctMetaDia, 0), sub: `Meta: ${fmtBRL(data.meta.metaDia)}`, color: pctMetaDia >= 100 ? COLORS.green : COLORS.orange, icon: '🎯' },
                { label: 'TICKET MÉDIO', value: fmtBRL(data.dia.ticketMedio), sub: `${data.dia.clientesAtendidos} clientes`, color: COLORS.sky, icon: '🧾' },
                { label: 'POSITIVAÇÃO', value: `${data.positivacao.hoje}`, sub: `${fmtPct(pctPosDia)} de ${fmtNum(data.positivacao.baseAtiva)}`, color: COLORS.green, icon: '✅' },
            ];

            kpis.forEach((kpi, idx) => {
                const cardX = 36 + idx * (kpiW + kpiGap);

                // Sombra sutil
                doc.roundedRect(cardX + 1, y + 1, kpiW, kpiH, 5).fill('#e8e8ec');
                // Card
                doc.roundedRect(cardX, y, kpiW, kpiH, 5).fill(COLORS.cardBg);
                doc.roundedRect(cardX, y, kpiW, kpiH, 5).lineWidth(0.6).strokeColor(COLORS.cardBorder).stroke();

                // Indicador lateral
                doc.rect(cardX + 4, y + 8, 3, kpiH - 16).fill(kpi.color);

                // Label
                doc.fillColor(COLORS.textLight).fontSize(6.5).font('Helvetica-Bold').text(kpi.label, cardX + 13, y + 7, { width: kpiW - 18 });
                // Valor principal
                doc.fillColor(COLORS.textDark).fontSize(13).font('Helvetica-Bold').text(kpi.value, cardX + 13, y + 18, { width: kpiW - 18 });
                // Sub-texto
                doc.fillColor(COLORS.textLight).fontSize(6.5).font('Helvetica').text(kpi.sub, cardX + 13, y + 40, { width: kpiW - 18 });
            });

            y += kpiH + 12;

            // ─── SEÇÃO 2: BARRA DE PROGRESSO MÊS vs META ────
            doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('ACUMULADO DO MÊS vs META', 36, y);
            y += 13;

            const pctMes = data.meta.metaMes > 0 ? (data.mes.vendas / data.meta.metaMes) * 100 : 0;
            
            // Card do progresso
            doc.roundedRect(36, y, 523, 42, 5).fill(COLORS.cardBg);
            doc.roundedRect(36, y, 523, 42, 5).lineWidth(0.6).strokeColor(COLORS.cardBorder).stroke();

            // Valores
            doc.fillColor(COLORS.textDark).fontSize(9).font('Helvetica-Bold')
               .text(`Realizado Líq.: ${fmtBRL(data.mes.vendas)}`, 46, y + 6);
            doc.fillColor(COLORS.textMuted).fontSize(8).font('Helvetica')
               .text(`Meta Mês: ${fmtBRL(data.meta.metaMes)}`, 300, y + 6, { align: 'right', width: 249 });

            // Barra de progresso
            const barX = 46;
            const barY = y + 22;
            const barW = 503;
            const barH = 10;

            // Fundo da barra
            doc.roundedRect(barX, barY, barW, barH, 4).fill('#e2e8f0');
            
            // Progresso com gradiente
            const progressW = Math.min(barW, (pctMes / 100) * barW);
            if (progressW > 0) {
                const progColor = pctMes >= 100 ? COLORS.green : pctMes >= 70 ? COLORS.sky : pctMes >= 40 ? COLORS.amber : COLORS.red;
                const progGrad = doc.linearGradient(barX, barY, barX + progressW, barY);
                progGrad.stop(0, progColor).stop(1, pctMes >= 100 ? COLORS.emerald : progColor);
                doc.roundedRect(barX, barY, progressW, barH, 4).fill(progGrad);
            }

            // Percentual na barra
            doc.fillColor(pctMes >= 15 ? '#ffffff' : COLORS.textDark).fontSize(7).font('Helvetica-Bold')
               .text(fmtPct(pctMes, 1), barX + (pctMes >= 15 ? progressW - 35 : progressW + 4), barY + 1.5);

            // Faltando
            const faltando = Math.max(0, data.meta.metaMes - data.mes.vendas);
            doc.fillColor(COLORS.textMuted).fontSize(7).font('Helvetica')
               .text(`Faltam: ${fmtBRL(faltando)} | Bruto Mês: ${fmtBRLCompact(data.mes.vendasBruta)} | Devoluções: ${fmtBRLCompact(data.mes.devolucoes)} | Dias Úteis: ${data.mes.diasUteis}`, 46, barY + 13);

            y += 50;

            // ─── SEÇÃO 3: MINI-CARDS (Novos, Reativações, Mix) ────
            const miniW = 168;
            const miniH = 40;
            const miniGap = 9.5;

            const miniCards = [
                { label: 'NOVOS CLIENTES', value: String(data.novosClientes), sub: `Meta: ${Math.round(data.meta.metaNovos)} | Mês: ${data.mes.novosClientes}`, color: COLORS.cyan, icon: '👤' },
                { label: 'REATIVAÇÕES', value: String(data.reativados), sub: `Meta: ${Math.round(data.meta.metaReativados)} | Mês: ${data.mes.reativados}`, color: COLORS.rose, icon: '🔄' },
                { label: 'MIX DE PRODUTOS', value: String(data.dia.mixTotal), sub: `Itens distintos (Mês: ${data.mes.mixTotal})`, color: COLORS.indigo, icon: '📦' },
            ];

            miniCards.forEach((card, idx) => {
                const cardX = 36 + idx * (miniW + miniGap);
                doc.roundedRect(cardX + 1, y + 1, miniW, miniH, 4).fill('#e8e8ec');
                doc.roundedRect(cardX, y, miniW, miniH, 4).fill(COLORS.cardBg);
                doc.roundedRect(cardX, y, miniW, miniH, 4).lineWidth(0.6).strokeColor(COLORS.cardBorder).stroke();
                doc.rect(cardX + 4, y + 7, 3, miniH - 14).fill(card.color);
                doc.fillColor(COLORS.textLight).fontSize(6.5).font('Helvetica-Bold').text(card.label, cardX + 13, y + 6);
                doc.fillColor(COLORS.textDark).fontSize(14).font('Helvetica-Bold').text(card.value, cardX + 13, y + 15);
                doc.fillColor(COLORS.textLight).fontSize(6).font('Helvetica').text(card.sub, cardX + 13, y + 30);
            });

            y += miniH + 14;

            // ─── SEÇÃO 4: GRÁFICOS LADO A LADO ────────
            // Coluna esquerda: Vendas por Filial (mês) — barras horizontais
            // Coluna direita: Mix de Produtos por Departamento — donut

            doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('VENDAS POR FILIAL — MÊS', 36, y);
            doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('MIX POR DEPARTAMENTO — MÊS', 300, y);
            y += 14;

            // ── Barras horizontais: Vendas por Filial ──
            const filialData = data.vendasPorFilialMes || [];
            const maxVendaFilial = filialData.length > 0 ? Math.max(...filialData.map(f => f.TOTAL_VENDAS)) : 1;
            const barColors = [COLORS.purple, COLORS.sky, COLORS.green, COLORS.orange, COLORS.rose, COLORS.cyan];
            
            const barsStartY = y;
            filialData.forEach((filial, idx) => {
                if (idx >= 6) return; // Max 6 filiais
                const bY = y + (idx * 26);
                const filialName = truncText(filial.NOMEFILIAL || `Filial ${filial.CODFILIAL}`, 22);
                const pct = maxVendaFilial > 0 ? (filial.TOTAL_VENDAS / maxVendaFilial) : 0;
                
                doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold').text(filialName, 36, bY);
                doc.fillColor(COLORS.textMuted).fontSize(6.5).font('Helvetica')
                   .text(fmtBRL(filial.TOTAL_VENDAS), 36, bY + 9);

                // Barra
                const fBarW = 240;
                const fBarH = 6;
                doc.roundedRect(36, bY + 18, fBarW, fBarH, 3).fill('#e2e8f0');
                const progW = pct * fBarW;
                if (progW > 0) {
                    doc.roundedRect(36, bY + 18, progW, fBarH, 3).fill(barColors[idx % barColors.length]);
                }
            });

            // ── Donut Chart: Mix por Departamento ──
            const mixData = data.mixProdutosMes.length > 0 ? data.mixProdutosMes : data.mixProdutosDia;
            const totalMix = mixData.reduce((sum, m) => sum + Number(m.VALOR_TOTAL || 0), 0);

            if (totalMix > 0 && mixData.length > 0) {
                const cx = 410;
                const cy = y + 48;
                const outerR = 46;
                const innerR = 26;

                let startAngle = -Math.PI / 2; // Começa no topo

                mixData.forEach((dept, idx) => {
                    if (idx >= 6) return;
                    const sliceVal = Number(dept.VALOR_TOTAL || 0);
                    const slicePct = sliceVal / totalMix;
                    const endAngle = startAngle + slicePct * 2 * Math.PI;

                    // Desenha fatia do donut usando arco
                    const color = PIE_COLORS[idx % PIE_COLORS.length];
                    
                    // Caminho do arco (polígono com muitos pontos)
                    const steps = Math.max(8, Math.ceil(slicePct * 60));
                    doc.save();
                    doc.moveTo(
                        cx + innerR * Math.cos(startAngle),
                        cy + innerR * Math.sin(startAngle)
                    );
                    // Arco externo
                    for (let s = 0; s <= steps; s++) {
                        const angle = startAngle + (s / steps) * (endAngle - startAngle);
                        doc.lineTo(cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle));
                    }
                    // Arco interno (reverso)
                    for (let s = steps; s >= 0; s--) {
                        const angle = startAngle + (s / steps) * (endAngle - startAngle);
                        doc.lineTo(cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle));
                    }
                    doc.closePath().fill(color);
                    doc.restore();

                    startAngle = endAngle;
                });

                // Centro do donut — texto
                doc.fillColor(COLORS.textDark).fontSize(7.5).font('Helvetica-Bold')
                   .text(fmtBRLCompact(totalMix), cx - 25, cy - 7, { width: 50, align: 'center' });
                doc.fillColor(COLORS.textMuted).fontSize(5.5).font('Helvetica')
                   .text('Total Mix', cx - 20, cy + 3, { width: 40, align: 'center' });

                // Legenda
                const legY = y + 104;
                mixData.forEach((dept, idx) => {
                    if (idx >= 6) return;
                    const lY = legY + idx * 11;
                    const slicePct = totalMix > 0 ? ((Number(dept.VALOR_TOTAL || 0) / totalMix) * 100).toFixed(1) : '0.0';
                    doc.rect(310, lY + 1, 7, 7).fill(PIE_COLORS[idx % PIE_COLORS.length]);
                    doc.fillColor(COLORS.textDark).fontSize(6.5).font('Helvetica')
                       .text(`${truncText(dept.DEPARTAMENTO, 18)} (${slicePct}%)`, 320, lY, { width: 140 });
                });
            } else {
                doc.fillColor(COLORS.textLight).fontSize(8).font('Helvetica')
                   .text('Sem dados de mix disponíveis.', 310, y + 10);
            }

            // Calcular onde seção termina (max de barras e donut)
            const barsEndY = barsStartY + Math.min(filialData.length, 6) * 26;
            const donutEndY = barsStartY + (mixData.length > 0 ? 166 : 20);
            y = Math.max(barsEndY, donutEndY) + 10;

            // ─── SEÇÃO 5: TENDÊNCIA (últimos 5 dias) ──────
            if (data.vendasUltimos5Dias && data.vendasUltimos5Dias.length > 0) {
                if (y > 620) {
                    doc.addPage();
                    drawHeader();
                    y = 64;
                }

                doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('TENDÊNCIA DE VENDAS — ÚLTIMOS DIAS', 36, y);
                y += 14;

                const trendData = data.vendasUltimos5Dias;
                const maxTrend = Math.max(...trendData.map(d => d.TOTAL_VENDAS), 1);
                const tBarW = 523;
                const tBarH = 18;

                trendData.forEach((dia, idx) => {
                    const tY = y + idx * (tBarH + 8);
                    const dateLabel = new Date(dia.DIA).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                    const pct = dia.TOTAL_VENDAS / maxTrend;

                    doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold')
                       .text(dateLabel, 36, tY + 2, { width: 65 });
                    
                    // Barra
                    const barAreaW = 380;
                    doc.roundedRect(105, tY, barAreaW, tBarH, 4).fill('#e2e8f0');
                    const progWidth = pct * barAreaW;
                    if (progWidth > 0) {
                        const tGrad = doc.linearGradient(105, tY, 105 + progWidth, tY);
                        tGrad.stop(0, '#8b5cf6').stop(1, '#a78bfa');
                        doc.roundedRect(105, tY, progWidth, tBarH, 4).fill(tGrad);
                    }

                    // Valor dentro/fora da barra
                    doc.fillColor(pct > 0.15 ? '#ffffff' : COLORS.textDark).fontSize(7).font('Helvetica-Bold')
                       .text(fmtBRL(dia.TOTAL_VENDAS), pct > 0.15 ? 105 + progWidth - 65 : 105 + progWidth + 4, tY + 5);

                    // Info direita
                    doc.fillColor(COLORS.textMuted).fontSize(6.5).font('Helvetica')
                       .text(`${dia.PEDIDOS}ped | ${dia.CLIENTES}cli | TM:${fmtBRL(dia.TICKET_MEDIO)}`, 490, tY + 2, { align: 'right', width: 69 });
                });

                y += trendData.length * (tBarH + 8) + 6;
            }

            // ─── SEÇÃO 6: DETALHAMENTO POR FILIAL ─────
            if (data.meta.porFilial && data.meta.porFilial.length > 0 && data.vendasPorFilialMes.length > 0) {
                if (y > 620) {
                    doc.addPage();
                    drawHeader();
                    y = 64;
                }

                doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('META vs REALIZADO POR FILIAL — MÊS', 36, y);
                y += 14;

                // Header da tabela
                doc.rect(36, y, 523, 14).fill('#f1f5f9');
                doc.fillColor(COLORS.textMuted).font('Helvetica-Bold').fontSize(7);
                doc.text('Filial', 42, y + 3, { width: 120 });
                doc.text('Meta (R$)', 170, y + 3, { width: 85 });
                doc.text('Realizado (R$)', 260, y + 3, { width: 85 });
                doc.text('% Atingido', 350, y + 3, { width: 60 });
                doc.text('Faltando (R$)', 415, y + 3, { width: 85 });
                doc.text('Progresso', 500, y + 3, { width: 60 });
                doc.strokeColor(COLORS.cardBorder).lineWidth(0.5).moveTo(36, y + 14).lineTo(559, y + 14).stroke();
                y += 14;

                data.meta.porFilial.forEach((filialMeta, idx) => {
                    if (y > 750) {
                        doc.addPage();
                        drawHeader();
                        y = 64;
                    }

                    const filialVendas = data.vendasPorFilialMes.find(v => String(v.CODFILIAL) === String(filialMeta.CODFILIAL));
                    const realizado = filialVendas ? filialVendas.TOTAL_VENDAS : 0;
                    const meta = filialMeta.META_VENDA;
                    const pctAtingido = meta > 0 ? (realizado / meta) * 100 : 0;
                    const falta = Math.max(0, meta - realizado);
                    const filialName = truncText(filialMeta.NOMEFILIAL || `Filial ${filialMeta.CODFILIAL}`, 20);

                    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                    doc.rect(36, y, 523, 16).fill(rowBg);

                    doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold')
                       .text(filialName, 42, y + 4, { width: 120 });
                    doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica')
                       .text(fmtBRL(meta), 170, y + 4, { width: 85 });
                    doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold')
                       .text(fmtBRL(realizado), 260, y + 4, { width: 85 });
                    
                    const pctColor = pctAtingido >= 100 ? COLORS.green : pctAtingido >= 70 ? COLORS.amber : COLORS.red;
                    doc.fillColor(pctColor).fontSize(7).font('Helvetica-Bold')
                       .text(fmtPct(pctAtingido, 1), 350, y + 4, { width: 60 });
                    doc.fillColor(COLORS.textMuted).fontSize(7).font('Helvetica')
                       .text(fmtBRL(falta), 415, y + 4, { width: 85 });

                    // Mini barra de progresso
                    const miniBarW = 50;
                    const miniBarH = 5;
                    doc.roundedRect(505, y + 5.5, miniBarW, miniBarH, 2).fill('#e2e8f0');
                    const miniProg = Math.min(miniBarW, (pctAtingido / 100) * miniBarW);
                    if (miniProg > 0) {
                        doc.roundedRect(505, y + 5.5, miniProg, miniBarH, 2).fill(pctColor);
                    }

                    doc.strokeColor(COLORS.divider).lineWidth(0.3).moveTo(36, y + 16).lineTo(559, y + 16).stroke();
                    y += 16;
                });

                // Linha de total
                const totalRealizado = data.mes.vendas;
                const totalMeta = data.meta.metaMes;
                const totalPct = totalMeta > 0 ? (totalRealizado / totalMeta) * 100 : 0;

                doc.rect(36, y, 523, 18).fill('#f1f5f9');
                doc.fillColor(COLORS.textDark).fontSize(7.5).font('Helvetica-Bold');
                doc.text('TOTAL GERAL', 42, y + 5, { width: 120 });
                doc.text(fmtBRL(totalMeta), 170, y + 5, { width: 85 });
                doc.text(fmtBRL(totalRealizado), 260, y + 5, { width: 85 });
                const totalPctColor = totalPct >= 100 ? COLORS.green : totalPct >= 70 ? COLORS.amber : COLORS.red;
                doc.fillColor(totalPctColor).text(fmtPct(totalPct, 1), 350, y + 5, { width: 60 });
                doc.fillColor(COLORS.textDark).text(fmtBRL(Math.max(0, totalMeta - totalRealizado)), 415, y + 5, { width: 85 });

                y += 24;
            }

            // ─── SEÇÃO 7: ORIGEM DOS DADOS (ORACLE) ───
            if (y > 600) {
                doc.addPage();
                drawHeader();
                y = 64;
            }

            doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('ORIGEM DAS INFORMAÇÕES (ORACLE WINTHOR)', 36, y);
            y += 14;

            // Box para mapeamento de dados
            const infoBoxH = 100;
            doc.roundedRect(36, y, 523, infoBoxH, 4).fill('#f8fafc');
            doc.roundedRect(36, y, 523, infoBoxH, 4).lineWidth(0.5).strokeColor(COLORS.cardBorder).stroke();

            // Conteúdo em colunas
            doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold');
            
            let col1X = 46;
            let rowY = y + 8;
            doc.text('Métrica / Indicador', col1X, rowY, { width: 120 });
            doc.text('Tabela(s) no Oracle', col1X + 130, rowY, { width: 110 });
            doc.text('Regra / Campos Utilizados', col1X + 250, rowY, { width: 200 });

            doc.strokeColor(COLORS.divider).lineWidth(0.3).moveTo(46, rowY + 10).lineTo(549, rowY + 10).stroke();
            
            const mapping = [
                { metric: 'Vendas Líquidas / Ticket', tables: 'PCMOV, PCNFSAID', rules: 'Venda (CODOPER=\'S\') menos devolução (CODOPER=\'ED\') somando frete (VLFRETE) com join na PCNFSAID' },
                { metric: 'Metas (Venda, Novos, Reativ.)', tables: 'PCMETARCA, PCMETA', rules: 'Metas diárias (VLVENDAPREV, QTPEDPREV, QTITENSPEDPREV) da PCMETARCA' },
                { metric: 'Positivação / Carteira', tables: 'PCNFSAID, PCCLIENT', rules: 'Clientes faturados na PCNFSAID vs clientes na carteira (CODUSUR1) de RCAs ativos com meta' },
                { metric: 'Novos Clientes / Reativ.', tables: 'PCCLIENT, PCNFSAID', rules: 'Novos: DTCADASTRO hoje/mês. Reativados: faturado sem compras nos últimos 180 dias.' },
                { metric: 'Mix de Produtos', tables: 'PCMOV, PCPRODUT, PCDEPTO', rules: 'Mix diário/mensal é a quantidade de produtos distintos vendidos (CODOPER=\'S\') de forma global.' },
            ];

            mapping.forEach((item, idx) => {
                const itemY = rowY + 14 + (idx * 15);
                doc.font('Helvetica-Bold').fillColor(COLORS.textDark).text(item.metric, col1X, itemY, { width: 120 });
                doc.font('Helvetica').fillColor(COLORS.textMuted).text(item.tables, col1X + 130, itemY, { width: 110 });
                doc.text(item.rules, col1X + 250, itemY, { width: 270 });
                
                if (idx < mapping.length - 1) {
                    doc.strokeColor(COLORS.divider).lineWidth(0.3).moveTo(46, itemY + 11).lineTo(549, itemY + 11).stroke();
                }
            });

            y += infoBoxH + 15;

            // ─── DETALHAMENTO DE POSITIVAÇÃO, NOVOS E REATIVADOS POR RCA (PÁGINA 3+) ───
            doc.addPage();
            drawHeader();
            y = 64;

            doc.fillColor(COLORS.textDark).fontSize(11).font('Helvetica-Bold').text('DESEMPENHO E POSITIVAÇÃO POR RCA', 36, y);
            y += 18;

            // Cabeçalho da tabela de RCAs
            doc.rect(36, y, 523, 16).fill(COLORS.brand);
            doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
            doc.text('RCA', 42, y + 4, { width: 30 });
            doc.text('Vendedor', 75, y + 4, { width: 120 });
            doc.text('Carteira', 200, y + 4, { width: 45, align: 'right' });
            doc.text('Posit.', 250, y + 4, { width: 35, align: 'right' });
            doc.text('% Pos.', 290, y + 4, { width: 35, align: 'right' });
            doc.text('Novos', 330, y + 4, { width: 30, align: 'right' });
            doc.text('Reat.', 365, y + 4, { width: 30, align: 'right' });
            doc.text('Venda Líq. (R$)', 410, y + 4, { width: 100, align: 'right' });
            y += 16;

            let rcaTotalCarteira = 0;
            let rcaTotalPosit = 0;
            let rcaTotalNovos = 0;
            let rcaTotalReat = 0;
            let rcaTotalLiq = 0;

            (data.positivacaoDetalhes || []).forEach((rca, idx) => {
                if (y > 740) {
                    doc.addPage();
                    drawHeader();
                    y = 64;
                    doc.rect(36, y, 523, 16).fill(COLORS.brand);
                    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
                    doc.text('RCA', 42, y + 4, { width: 30 });
                    doc.text('Vendedor', 75, y + 4, { width: 120 });
                    doc.text('Carteira', 200, y + 4, { width: 45, align: 'right' });
                    doc.text('Posit.', 250, y + 4, { width: 35, align: 'right' });
                    doc.text('% Pos.', 290, y + 4, { width: 35, align: 'right' });
                    doc.text('Novos', 330, y + 4, { width: 30, align: 'right' });
                    doc.text('Reat.', 365, y + 4, { width: 30, align: 'right' });
                    doc.text('Venda Líq. (R$)', 410, y + 4, { width: 100, align: 'right' });
                    y += 16;
                }

                rcaTotalCarteira += rca.CARTEIRA;
                rcaTotalPosit += rca.POSITIVADOS;
                rcaTotalNovos += rca.NOVOS;
                rcaTotalReat += rca.REATIVADOS;
                rcaTotalLiq += rca.LIQUIDO;

                const pct = rca.CARTEIRA > 0 ? (rca.POSITIVADOS / rca.CARTEIRA) * 100 : 0;
                const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                doc.rect(36, y, 523, 15).fill(rowBg);

                doc.fillColor(COLORS.textDark).fontSize(6.5).font('Helvetica-Bold').text(String(rca.CODUSUR), 42, y + 4, { width: 30 });
                doc.font('Helvetica').text(truncText(rca.NOME, 28), 75, y + 4, { width: 120 });
                doc.text(fmtNum(rca.CARTEIRA), 200, y + 4, { width: 45, align: 'right' });
                doc.font('Helvetica-Bold').text(fmtNum(rca.POSITIVADOS), 250, y + 4, { width: 35, align: 'right' });
                doc.text(fmtPct(pct, 1), 290, y + 4, { width: 35, align: 'right' });
                doc.font('Helvetica').text(fmtNum(rca.NOVOS), 330, y + 4, { width: 30, align: 'right' });
                doc.text(fmtNum(rca.REATIVADOS), 365, y + 4, { width: 30, align: 'right' });
                doc.font('Helvetica-Bold').text(fmtBRL(rca.LIQUIDO), 410, y + 4, { width: 100, align: 'right' });

                doc.strokeColor(COLORS.divider).lineWidth(0.25).moveTo(36, y + 15).lineTo(559, y + 15).stroke();
                y += 15;
            });

            // Linha de totalizadores do RCA
            doc.rect(36, y, 523, 16).fill('#f1f5f9');
            doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold');
            doc.text('TOTAL', 42, y + 4, { width: 30 });
            doc.text(fmtNum(rcaTotalCarteira), 200, y + 4, { width: 45, align: 'right' });
            doc.text(fmtNum(rcaTotalPosit), 250, y + 4, { width: 35, align: 'right' });
            const totalPct = rcaTotalCarteira > 0 ? (rcaTotalPosit / rcaTotalCarteira) * 100 : 0;
            doc.text(fmtPct(totalPct, 1), 290, y + 4, { width: 35, align: 'right' });
            doc.text(fmtNum(rcaTotalNovos), 330, y + 4, { width: 30, align: 'right' });
            doc.text(fmtNum(rcaTotalReat), 365, y + 4, { width: 30, align: 'right' });
            doc.text(fmtBRL(rcaTotalLiq), 410, y + 4, { width: 100, align: 'right' });
            y += 24;

            // Lista de novos clientes
            if (y > 600) {
                doc.addPage();
                drawHeader();
                y = 64;
            }

            doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('CLIENTES NOVOS CADASTRADOS NO DIA', 36, y);
            y += 14;

            if (!data.novosClientesDetalhes || data.novosClientesDetalhes.length === 0) {
                doc.fillColor(COLORS.textMuted).fontSize(7.5).font('Helvetica-Oblique').text('Nenhum cliente novo cadastrado neste dia.', 46, y);
                y += 20;
            } else {
                doc.rect(36, y, 523, 14).fill('#e2e8f0');
                doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold');
                doc.text('Cód. Cliente', 42, y + 3, { width: 60 });
                doc.text('Razão Social / Nome do Cliente', 110, y + 3, { width: 200 });
                doc.text('RCA Vendedor', 320, y + 3, { width: 130 });
                doc.text('Valor Compra (R$)', 460, y + 3, { width: 90, align: 'right' });
                y += 14;

                data.novosClientesDetalhes.forEach((c, idx) => {
                    if (y > 750) {
                        doc.addPage();
                        drawHeader();
                        y = 64;
                        doc.rect(36, y, 523, 14).fill('#e2e8f0');
                        doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold');
                        doc.text('Cód. Cliente', 42, y + 3, { width: 60 });
                        doc.text('Razão Social / Nome do Cliente', 110, y + 3, { width: 200 });
                        doc.text('RCA Vendedor', 320, y + 3, { width: 130 });
                        doc.text('Valor Compra (R$)', 460, y + 3, { width: 90, align: 'right' });
                        y += 14;
                    }

                    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                    doc.rect(36, y, 523, 13).fill(rowBg);

                    doc.fillColor(COLORS.textDark).fontSize(6.5).font('Helvetica-Bold').text(String(c.CODCLI), 42, y + 3, { width: 60 });
                    doc.font('Helvetica').text(truncText(c.NOME_CLIENTE, 42), 110, y + 3, { width: 200 });
                    doc.text(`${c.RCA} - ${truncText(c.NOME_RCA, 18)}`, 320, y + 3, { width: 130 });
                    doc.font('Helvetica-Bold').text(fmtBRL(c.VALOR_COMPRA), 460, y + 3, { width: 90, align: 'right' });

                    doc.strokeColor(COLORS.divider).lineWidth(0.2).moveTo(36, y + 13).lineTo(559, y + 13).stroke();
                    y += 13;
                });
                y += 20;
            }

            // Lista de clientes reativados
            if (y > 600) {
                doc.addPage();
                drawHeader();
                y = 64;
            }

            doc.fillColor(COLORS.textDark).fontSize(10).font('Helvetica-Bold').text('CLIENTES REATIVADOS NO DIA (Inativos há 180d+)', 36, y);
            y += 14;

            if (!data.reativadosDetalhes || data.reativadosDetalhes.length === 0) {
                doc.fillColor(COLORS.textMuted).fontSize(7.5).font('Helvetica-Oblique').text('Nenhum cliente reativado neste dia.', 46, y);
                y += 20;
            } else {
                doc.rect(36, y, 523, 14).fill('#e2e8f0');
                doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold');
                doc.text('Cód. Cliente', 42, y + 3, { width: 60 });
                doc.text('Razão Social / Nome do Cliente', 110, y + 3, { width: 200 });
                doc.text('RCA Vendedor', 320, y + 3, { width: 130 });
                doc.text('Valor Compra (R$)', 460, y + 3, { width: 90, align: 'right' });
                y += 14;

                data.reativadosDetalhes.forEach((c, idx) => {
                    if (y > 750) {
                        doc.addPage();
                        drawHeader();
                        y = 64;
                        doc.rect(36, y, 523, 14).fill('#e2e8f0');
                        doc.fillColor(COLORS.textDark).fontSize(7).font('Helvetica-Bold');
                        doc.text('Cód. Cliente', 42, y + 3, { width: 60 });
                        doc.text('Razão Social / Nome do Cliente', 110, y + 3, { width: 200 });
                        doc.text('RCA Vendedor', 320, y + 3, { width: 130 });
                        doc.text('Valor Compra (R$)', 460, y + 3, { width: 90, align: 'right' });
                        y += 14;
                    }

                    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                    doc.rect(36, y, 523, 13).fill(rowBg);

                    doc.fillColor(COLORS.textDark).fontSize(6.5).font('Helvetica-Bold').text(String(c.CODCLI), 42, y + 3, { width: 60 });
                    doc.font('Helvetica').text(truncText(c.NOME_CLIENTE, 42), 110, y + 3, { width: 200 });
                    doc.text(`${c.RCA} - ${truncText(c.NOME_RCA, 18)}`, 320, y + 3, { width: 130 });
                    doc.font('Helvetica-Bold').text(fmtBRL(c.VALOR_COMPRA), 460, y + 3, { width: 90, align: 'right' });

                    doc.strokeColor(COLORS.divider).lineWidth(0.2).moveTo(36, y + 13).lineTo(559, y + 13).stroke();
                    y += 13;
                });
                y += 20;
            }


            // ─── RODAPÉ ──────────────────────────────
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                const oldBottomMargin = doc.page.margins.bottom;
                doc.page.margins.bottom = 0;

                doc.strokeColor(COLORS.cardBorder).lineWidth(0.5).moveTo(36, 800).lineTo(559, 800).stroke();
                doc.fillColor(COLORS.textMuted).fontSize(8).font('Helvetica')
                   .text('Relatório de Vendas Diário — Brago App System', 36, 808);
                doc.text(`Página ${i + 1} de ${range.count}`, 450, 808, { align: 'right', width: 109 });

                doc.page.margins.bottom = oldBottomMargin;
            }

            doc.end();

            stream.on('finish', () => resolve(PDF_TEMP_PATH));
            stream.on('error', (err) => reject(err));

        } catch (err) {
            reject(err);
        }
    });
}

// ─── Envio e Agendamento ─────────────────────────────

/**
 * Gera e envia o PDF de vendas para os números configurados
 * @param {boolean} force Se true, envia mesmo sem vendas
 * @param {Date} targetDate Data de referência para consulta
 * @returns {Promise<Object>}
 */
async function sendSalesPdfReport(force = false, targetDate = new Date()) {
    logger.info(`📊 Iniciando geração do Relatório PDF de Vendas para ${targetDate.toLocaleDateString('pt-BR')}...`);

    let data;
    try {
        data = await salesOracleService.getFullSalesReport(targetDate);
    } catch (e) {
        logger.error(`❌ Erro ao buscar dados de vendas: ${e.message}`);
        throw e;
    }

    if (!force && data.dia.vendas === 0 && data.dia.pedidos === 0) {
        logger.info('⚠️ Nenhuma venda registrada para esta data. Envio do PDF de vendas pulado.');
        return { successCount: 0, errorCount: 0, skipped: true };
    }

    let pdfPath;
    try {
        pdfPath = await generateSalesPdf(data);
        logger.info(`✅ PDF de vendas gerado: ${pdfPath}`);
    } catch (e) {
        logger.error(`❌ Falha ao gerar PDF de vendas: ${e.message}`);
        throw e;
    }

    const numbers = configManager.getSalesPdfNotifyNumbers();
    if (numbers.length === 0) {
        logger.warn('⚠️ Nenhum número cadastrado para receber o PDF de vendas.');
        return { successCount: 0, errorCount: 0 };
    }

    let successCount = 0;
    let errorCount = 0;

    const rDate = data.targetDate ? new Date(data.targetDate) : targetDate;
    const dateStr = rDate.toLocaleDateString('pt-BR');
    const caption = `📊 *Relatório de Vendas Diário — ${dateStr}*\n\nSegue o resumo consolidado de vendas, metas, positivação e mix de produtos do dia.`;

    for (const number of numbers) {
        logger.info(`Enviando PDF de vendas para ${number}...`);
        const sent = await whatsapp.sendFileToNumber(number, pdfPath, caption);
        if (sent) {
            successCount++;
        } else {
            errorCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info(`📊 PDF de vendas enviado. Sucessos: ${successCount}, Falhas: ${errorCount}`);
    return { successCount, errorCount };
}

/**
 * Inicializa o agendamento cron do PDF de vendas
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const cronTime = configManager.getSalesPdfCronTime();
    logger.info(`⏰ Agendando rotina diária de vendas (cron: "${cronTime}")`);

    try {
        cronJob = CronJob.from({
            cronTime: cronTime,
            onTick: async () => {
                logger.info('⏰ Cron do Relatório PDF de Vendas ativado.');
                try {
                    if (whatsapp.isClientReady()) {
                        await sendSalesPdfReport(false);
                    } else {
                        logger.warn('⚠️ WhatsApp não pronto. Envio automático do PDF de vendas pulado.');
                    }
                } catch (err) {
                    logger.error(`Erro ao rodar cron de vendas: ${err.message}`);
                }
            },
            start: true,
            timeZone: "America/Sao_Paulo"
        });

        logger.info('🚀 Cron job de vendas inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de vendas: ${e.message}`);
    }
}

module.exports = {
    generateSalesPdf,
    sendSalesPdfReport,
    initScheduler
};
