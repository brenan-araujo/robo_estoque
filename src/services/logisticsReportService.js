const fs = require('fs');
const path = require('path');
const { CronJob } = require('cron');
const nodemailer = require('nodemailer');
const logisticsOracleService = require('./logisticsOracleService');
const logisticsExcelService = require('./logisticsExcelService');
const whatsapp = require('./whatsappService');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');


const SNAPSHOT_FILE = path.join(__dirname, '..', '..', 'data', 'logistics_snapshot.json');

let fridayJob = null;
let wednesdayJob = null;

/**
 * Carrega o snapshot de logística salvo anteriormente
 * @returns {Object} Snapshot de dados
 */
function loadSnapshot() {
    try {
        if (fs.existsSync(SNAPSHOT_FILE)) {
            return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        }
    } catch (e) {
        logger.error(`Erro ao ler snapshot de logística: ${e.message}`);
    }
    return {};
}

/**
 * Salva o snapshot de logística
 * @param {Object} snapshotData Dados do snapshot
 */
function saveSnapshot(snapshotData) {
    try {
        const dir = path.dirname(SNAPSHOT_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshotData, null, 2), 'utf8');
        logger.info('💾 Snapshot de logística atualizado com sucesso.');
    } catch (e) {
        logger.error(`Erro ao salvar snapshot de logística: ${e.message}`);
    }
}

/**
 * Compara os dados atuais com o snapshot de sexta-feira e gera o texto das alterações
 * @param {Array} currentItems Itens atuais da semana
 * @param {Array} snapshotItems Itens salvos no snapshot
 * @returns {string} Texto detalhando as alterações
 */
function compareAndGenerateDiffText(currentItems, snapshotItems) {
    const currentMap = {};
    const snapshotMap = {};

    for (const item of currentItems || []) {
        const key = `${item.CODFILIAL}-${item.NUMPED}-${item.CODIGO_PRODUTO}`;
        currentMap[key] = item;
    }

    for (const item of snapshotItems || []) {
        const key = `${item.CODFILIAL}-${item.NUMPED}-${item.CODIGO_PRODUTO}`;
        snapshotMap[key] = item;
    }

    const shortDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const formatShortDate = (date) => {
        if (!date) return 'Sem data';
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'Sem data';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const dayOfWeek = shortDays[d.getDay()];
        return `${dayOfWeek} ${day}/${month}`;
    };

    const formatDateOnly = (date) => {
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const addedLines = [];
    const removedLines = [];
    const modifiedLines = [];

    for (const [key, currentItem] of Object.entries(currentMap)) {
        const snapItem = snapshotMap[key];
        if (!snapItem) {
            // Adicionado
            const dateStr = formatShortDate(currentItem.PREV_ENTREGA);
            addedLines.push(`• *${currentItem.FORNECEDOR}* (Ped: ${currentItem.NUMPED}) - Prod: ${currentItem.CODIGO_PRODUTO} - ${currentItem.DESCRICAO_PRODUTO} | Qtd: ${currentItem.SALDO_PEDIDO.toLocaleString('pt-BR')} (${Math.round(currentItem.QTD_EMB_MASTER)} cx) | Prev: ${dateStr}`);
        } else {
            // Comparar campos modificados
            const currQty = currentItem.SALDO_PEDIDO;
            const snapQty = snapItem.SALDO_PEDIDO;
            const currDateStr = formatDateOnly(currentItem.PREV_ENTREGA);
            const snapDateStr = formatDateOnly(snapItem.PREV_ENTREGA);

            const qtyChanged = currQty !== snapQty;
            const dateChanged = currDateStr !== snapDateStr;

            if (qtyChanged || dateChanged) {
                let changeDetails = [];
                if (qtyChanged) {
                    changeDetails.push(`Qtd: ${snapQty.toLocaleString('pt-BR')} → ${currQty.toLocaleString('pt-BR')} un.`);
                }
                if (dateChanged) {
                    changeDetails.push(`Data: ${formatShortDate(snapItem.PREV_ENTREGA)} → ${formatShortDate(currentItem.PREV_ENTREGA)}`);
                }
                modifiedLines.push(`• *${currentItem.FORNECEDOR}* (Ped: ${currentItem.NUMPED}) - Prod: ${currentItem.CODIGO_PRODUTO} - ${currentItem.DESCRICAO_PRODUTO}\n  └─ ${changeDetails.join(' | ')}`);
            }
        }
    }

    for (const [key, snapItem] of Object.entries(snapshotMap)) {
        if (!currentMap[key]) {
            // Removido
            const dateStr = formatShortDate(snapItem.PREV_ENTREGA);
            removedLines.push(`• *${snapItem.FORNECEDOR}* (Ped: ${snapItem.NUMPED}) - Prod: ${snapItem.CODIGO_PRODUTO} - ${snapItem.DESCRICAO_PRODUTO} | Qtd: ${snapItem.SALDO_PEDIDO.toLocaleString('pt-BR')} | Prev: ${dateStr}`);
        }
    }

    let diffText = '';

    if (addedLines.length > 0 || removedLines.length > 0 || modifiedLines.length > 0) {
        diffText += `🔄 *Alterações desde Sexta-Feira (16h):*\n\n`;
        
        if (addedLines.length > 0) {
            diffText += `➕ *Pedidos Adicionados (${addedLines.length}):*\n`;
            const displayed = addedLines.slice(0, 10);
            diffText += displayed.join('\n') + '\n';
            if (addedLines.length > 10) {
                diffText += `_... e mais ${addedLines.length - 10} pedido(s) adicionado(s)._\n`;
            }
            diffText += `\n`;
        }
        
        if (removedLines.length > 0) {
            diffText += `❌ *Pedidos Removidos/Cancelados (${removedLines.length}):*\n`;
            const displayed = removedLines.slice(0, 10);
            diffText += displayed.join('\n') + '\n';
            if (removedLines.length > 10) {
                diffText += `_... e mais ${removedLines.length - 10} pedido(s) removido(s)._\n`;
            }
            diffText += `\n`;
        }
        
        if (modifiedLines.length > 0) {
            diffText += `📝 *Pedidos Modificados (${modifiedLines.length}):*\n`;
            const displayed = modifiedLines.slice(0, 10);
            diffText += displayed.join('\n') + '\n';
            if (modifiedLines.length > 10) {
                diffText += `_... e mais ${modifiedLines.length - 10} pedido(s) modificado(s)._\n`;
            }
            diffText += `\n`;
        }
    } else {
        diffText += `🔄 *Alterações desde Sexta-Feira (16h):* Nenhuma alteração identificada.\n\n`;
    }

    return diffText;
}

/**
 * Monta o bloco HTML de transferências em trânsito para o e-mail
 */
function buildTransfersEmailSection(transfers) {
    if (!transfers || transfers.length === 0) return '';

    const filialLabels = {
        '20': 'DF-CD (20)', '6': 'DF-Loja (6)',
        '21': 'GO (21)', '22': 'TO (22)', '23': 'MS (23)'
    };
    const getFilialLabel = (code) => filialLabels[String(code)] || `Filial ${code}`;

    // Agrupar por NUMTRANSVENDA
    const grouped = {};
    transfers.forEach(t => {
        const key = t.NUMTRANSVENDA;
        if (!grouped[key]) {
            grouped[key] = {
                numtrans: t.NUMTRANSVENDA,
                origem: t.CODFILIALORIGEM,
                destino: t.CODFILIALDESTINO,
                dias: t.DIAS_EM_TRANSITO,
                dtSaida: t.DTTRANSF,
                itens: 0,
                caixas: 0,
                volumeM3: 0
            };
        }
        grouped[key].itens += t.QTTRANSF || 0;
        grouped[key].caixas += t.QTD_CAIXAS || 0;
        grouped[key].volumeM3 += t.CUBAGEM_TOTAL || 0;
    });

    const rows = Object.values(grouped).map(g => {
        const diasStyle = g.dias >= 7
            ? 'color:#B91C1C; font-weight:bold;'
            : 'color:#334155;';
        const dtStr = g.dtSaida
            ? `${String(new Date(g.dtSaida).getDate()).padStart(2,'0')}/${String(new Date(g.dtSaida).getMonth()+1).padStart(2,'0')}`
            : '—';
        return `
            <tr>
                <td style="border-bottom:1px solid #f1f5f9; padding:8px 10px; font-size:12px; font-weight:600; color:#1e3a8a;">${g.numtrans}</td>
                <td style="border-bottom:1px solid #f1f5f9; padding:8px 10px; font-size:12px; color:#334155;">${getFilialLabel(g.origem)}</td>
                <td style="border-bottom:1px solid #f1f5f9; padding:8px 10px; font-size:12px; color:#334155; text-align:center;">${dtStr}</td>
                <td style="border-bottom:1px solid #f1f5f9; padding:8px 10px; font-size:12px; text-align:right; color:#0f172a;">${Math.round(g.itens).toLocaleString('pt-BR')} un.</td>
                <td style="border-bottom:1px solid #f1f5f9; padding:8px 10px; font-size:12px; text-align:right; color:#0f172a;">${g.caixas.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1})} cx</td>
                <td style="border-bottom:1px solid #f1f5f9; padding:8px 10px; font-size:12px; text-align:right; ${diasStyle}">${g.dias !== null ? g.dias + ' dias' : '—'}</td>
            </tr>`;
    }).join('');

    const totalVol = transfers.reduce((a, t) => a + (t.CUBAGEM_TOTAL || 0), 0);
    const totalItens = transfers.reduce((a, t) => a + (t.QTTRANSF || 0), 0);
    const uniqueTransfs = Object.keys(grouped).length;

    return `
        <div style="margin-top: 25px;">
            <h3 style="color: #1e3a8a; font-size: 15px; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-bottom: 10px;">
                🚚 Transferências em Trânsito
            </h3>
            <p style="font-size:12px; color:#64748b; margin-bottom:10px;">
                <strong>${transfers.length}</strong> ite${transfers.length !== 1 ? 'ns' : 'm'} em trânsito distribuído${transfers.length !== 1 ? 's' : ''} em <strong>${uniqueTransfs}</strong> transferência${uniqueTransfs !== 1 ? 's' : ''} | Volume total: <strong>${totalVol.toLocaleString('pt-BR', {minimumFractionDigits:3, maximumFractionDigits:3})} m³</strong>
            </p>
            <table width="100%" style="border-collapse:collapse; font-family:'Segoe UI',sans-serif;">
                <thead>
                    <tr>
                        <th style="background:#1e3a8a; color:#fff; font-size:11px; padding:8px 10px; text-align:left;">Nº Transf.</th>
                        <th style="background:#1e3a8a; color:#fff; font-size:11px; padding:8px 10px; text-align:left;">Origem</th>
                        <th style="background:#1e3a8a; color:#fff; font-size:11px; padding:8px 10px; text-align:center;">Saída</th>
                        <th style="background:#1e3a8a; color:#fff; font-size:11px; padding:8px 10px; text-align:right;">Itens</th>
                        <th style="background:#1e3a8a; color:#fff; font-size:11px; padding:8px 10px; text-align:right;">Caixas</th>
                        <th style="background:#1e3a8a; color:#fff; font-size:11px; padding:8px 10px; text-align:right;">Em Trânsito</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            <p style="font-size:11px; color:#94a3b8; margin-top:8px;">
                ⚠️ Itens destacados em vermelho estão há 7 ou mais dias em trânsito. Verifique o recebimento no destino.
            </p>
        </div>
    `;
}

/**
 * Monta o corpo HTML do e-mail de logística
 */
function buildHtmlEmail(data, isFriday, diffText = '', transfers = []) {
    const formatLabel = (d) => {
        if (!d) return '';
        const dObj = new Date(d);
        const dayStr = String(dObj.getDate()).padStart(2, '0');
        const monthStr = String(dObj.getMonth() + 1).padStart(2, '0');
        return `${dayStr}/${monthStr}`;
    };
    
    const weekLabel = (data.startOfWeek && data.endOfWeek)
        ? `${formatLabel(data.startOfWeek)} a ${formatLabel(data.endOfWeek)}`
        : 'Segunda a Sexta-Feira';

    // Linhas de volume diário
    let dailyRows = '';
    const dayMappings = {
        'Segunda-Feira': { abbrev: 'Seg', offset: 0 },
        'Terça-Feira': { abbrev: 'Ter', offset: 1 },
        'Quarta-Feira': { abbrev: 'Qua', offset: 2 },
        'Quinta-Feira': { abbrev: 'Qui', offset: 3 },
        'Sexta-Feira': { abbrev: 'Sex', offset: 4 }
    };
    const startOfWeek = data.startOfWeek || new Date();
    const daysOrdered = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira'];
    
    daysOrdered.forEach(d => {
        const subtotalRow = data.cronograma.find(r => r.dia === d && r.isSubtotal);
        const mapping = dayMappings[d];
        let dayLabel = d;
        if (mapping && startOfWeek) {
            const dateOfSlot = new Date(startOfWeek);
            dateOfSlot.setDate(startOfWeek.getDate() + mapping.offset);
            const dStr = String(dateOfSlot.getDate()).padStart(2, '0');
            const mStr = String(dateOfSlot.getMonth() + 1).padStart(2, '0');
            dayLabel = `${mapping.abbrev} ${dStr}/${mStr}`;
        }
        
        let volText = '—';
        let cxText = '';
        if (subtotalRow && subtotalRow.volumeM3 > 0) {
            volText = `${subtotalRow.volumeM3.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³`;
            cxText = `(${Math.round(subtotalRow.caixas).toLocaleString('pt-BR')} cx)`;
        }
        
        dailyRows += `
            <tr>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 10px; font-size: 13px; font-weight: 600; color: #334155;">${dayLabel}</td>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 10px; font-size: 13px; text-align: right; color: #0f172a; font-weight: bold;">${volText} <span style="font-weight: normal; color: #64748b; font-size: 11px;">${cxText}</span></td>
            </tr>
        `;
    });

    // Formatação de diferenças para quarta-feira
    let diffHtml = '';
    if (!isFriday && diffText) {
        let formattedDiff = diffText
            .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br/>')
            .replace(/• /g, '&bull; ');
        
        diffHtml = `
            <div style="margin-top: 25px; padding: 20px; background-color: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <h4 style="margin-top: 0; color: #1e3a8a; font-size: 14px; text-transform: uppercase; margin-bottom: 10px;">🔄 Alterações de Previsão Identificadas:</h4>
                <div style="font-size: 13px; line-height: 1.6; color: #334155;">
                    ${formattedDiff}
                </div>
            </div>
        `;
    }

    const transfersHtml = buildTransfersEmailSection(transfers);

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 20px; }
            .container { max-width: 650px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); padding: 30px; margin: 0 auto; border-top: 4px solid #0f172a; }
            .header { border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 20px; }
            .title { color: #0f172a; font-size: 20px; font-weight: 700; margin: 0; }
            .subtitle { color: #64748b; font-size: 13px; margin-top: 4px; }
            .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px; margin-top: 20px; }
            .kpi-card { background-color: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; text-align: center; }
            .kpi-title { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; margin-bottom: 4px; }
            .kpi-val { font-size: 16px; font-weight: bold; color: #0f172a; }
            .urgente { color: #b91c1c; background-color: #fef2f2; border-color: #fee2e2; }
            .sem-end { color: #92400e; background-color: #fffbeb; border-color: #fef3c7; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background-color: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 10px; border-bottom: 2px solid #e2e8f0; font-size: 12px; }
            .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2 class="title">📊 Relatório de Inteligência Logística</h2>
                <div class="subtitle">Filial: ${data.filialCode} | Semana: ${weekLabel}</div>
            </div>

            <div class="grid">
                <div class="kpi-card">
                    <div class="kpi-title">Pedidos a Chegar</div>
                    <div class="kpi-val">${data.kpis.totalPedidosSemana} pedidos</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">Volume Total</div>
                    <div class="kpi-val">${data.kpis.totalVolumeSemana.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³ (${Math.round(data.kpis.totalCaixasSemana).toLocaleString('pt-BR')} cx)</div>
                </div>
                <div class="kpi-card urgente">
                    <div class="kpi-title" style="color: #b91c1c;">Estoque Zero</div>
                    <div class="kpi-val">${data.kpis.totalUrgentes} itens</div>
                </div>
                <div class="kpi-card sem-end">
                    <div class="kpi-title" style="color: #92400e;">Sem Endereço</div>
                    <div class="kpi-val">${data.kpis.totalSemEndereco} itens</div>
                </div>
            </div>

            <h3 style="color: #0f172a; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px;">📅 Volume Previsto por Dia</h3>
            <table>
                <thead>
                    <tr>
                        <th>Dia da Semana</th>
                        <th style="text-align: right;">Volume Previsto</th>
                    </tr>
                </thead>
                <tbody>
                    ${dailyRows}
                </tbody>
            </table>

            ${diffHtml}
            ${transfersHtml}

            <p style="font-size: 12.5px; color: #64748b; margin-top: 25px; line-height: 1.5;">
                <em>*A planilha Excel detalhada com a lista de fornecedores, cronograma completo de descarga e produtos sem endereço/estoque zerado está anexada a este e-mail.</em>
            </p>

            <div class="footer">
                <p>Este relatório foi gerado automaticamente pelo Brago App System.</p>
                <p>© 2026 Brago Distribuidora. Todos os direitos reservados.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Envia o relatório de logística por e-mail para destinatários configurados
 */
async function sendEmailReport(data, isFriday, diffText, filePath, transfers = []) {
    const settings = configManager.getSettings();
    
    // Obter destinatários do settings ou usar Brenan como fallback
    let emailRecipients = [];
    if (settings.logisticsNotifyEmails) {
        if (Array.isArray(settings.logisticsNotifyEmails)) {
            emailRecipients = settings.logisticsNotifyEmails;
        } else {
            const specific = settings.logisticsNotifyEmails[data.filialCode] || [];
            const general = settings.logisticsNotifyEmails['GERAL'] || [];
            emailRecipients = [...new Set([...specific, ...general])];
        }
    }
    if (emailRecipients.length === 0) {
        emailRecipients = ['brenan.araujo@bragodistribuidora.com.br'];
    }

    try {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '465', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        const formatLabel = (d) => {
            if (!d) return '';
            const dObj = new Date(d);
            const dayStr = String(dObj.getDate()).padStart(2, '0');
            const monthStr = String(dObj.getMonth() + 1).padStart(2, '0');
            return `${dayStr}/${monthStr}`;
        };
        const weekLabel = (data.startOfWeek && data.endOfWeek)
            ? `${formatLabel(data.startOfWeek)} a ${formatLabel(data.endOfWeek)}`
            : 'Segunda a Sexta-Feira';

        const reportType = isFriday ? 'Sexta-Feira' : 'Quarta-Feira';
        const subject = `📊 [Relatório de ${reportType}] Inteligência Logística — ${data.filialCode} [Semana ${weekLabel}]`;
        const htmlBody = buildHtmlEmail(data, isFriday, diffText, transfers);

        const mailOptions = {
            from: `"Brago App System" <${process.env.SMTP_USER}>`,
            to: emailRecipients.join(', '),
            subject: subject,
            html: htmlBody,
            attachments: [
                {
                    filename: path.basename(filePath),
                    path: filePath
                }
            ]
        };

        logger.info(`Enviando e-mail de logística da filial ${data.filialCode} para: ${emailRecipients.join(', ')}...`);
        const info = await transporter.sendMail(mailOptions);
        logger.info(`✅ E-mail logístico da filial ${data.filialCode} enviado com sucesso: ${info.messageId}`);
        return true;
    } catch (err) {
        logger.error(`❌ Falha ao enviar e-mail de logística da filial ${data.filialCode}: ${err.message}`);
        return false;
    }
}

/**
 * Executa a rotina automatizada de Inteligência Logística
 * @param {boolean} isFriday Se true, executa a rotina de sexta-feira (forecast de offset=1, salva snapshot)
 * @returns {Promise<Object>} Resultado da execução
 */
async function runLogisticsReport(isFriday) {
    const settings = configManager.getSettings();
    const logisticsNotifyNumbers = settings.logisticsNotifyNumbers || {};
    const targets = ['20 + 6', '21', '22', '23', 'GERAL'];
    const weekOffset = isFriday ? 1 : 0;
    
    const filialLabels = {
        '20 + 6': 'DF (Brasília)',
        '21': 'GO (Goiânia)',
        '22': 'TO (Palmas)',
        '23': 'MS (Campo Grande)',
        'GERAL': 'GERAL (Todas as Filiais)'
    };

    const snapshot = isFriday ? {} : loadSnapshot();
    const newSnapshot = isFriday ? { ...loadSnapshot() } : {};

    logger.info(`🚀 Executando rotina de logística automatizada. Tipo: ${isFriday ? 'Sexta-Feira (Snapshot + Previsão Próxima Semana)' : 'Quarta-Feira (Atualização + Comparação)'}`);

    const results = [];

    for (const targetFilial of targets) {
        const numbers = logisticsNotifyNumbers[targetFilial] || [];
        const emails = (settings.logisticsNotifyEmails && !Array.isArray(settings.logisticsNotifyEmails))
            ? (settings.logisticsNotifyEmails[targetFilial] || [])
            : [];
        
        if (numbers.length === 0 && emails.length === 0) {
            continue;
        }

        try {
            const numbersLog = numbers.length > 0 ? `WhatsApp: ${numbers.join(', ')}` : '';
            const emailsLog = emails.length > 0 ? `E-mails: ${emails.join(', ')}` : '';
            const targetLog = [numbersLog, emailsLog].filter(Boolean).join(' | ');
            logger.info(`Processando filial ${targetFilial} (offset=${weekOffset}) para ${targetLog}`);
            
            // 1. Obter dados
            const data = await logisticsOracleService.getLogisticsData(targetFilial, weekOffset);

            // 1b. Obter transferências em trânsito para esta filial de destino
            let transfers = [];
            try {
                // Para GERAL, pula transferências (cada filial já recebe a própria)
                if (targetFilial !== 'GERAL' && targetFilial !== 'ALL') {
                    transfers = await logisticsOracleService.getInterBranchTransfers(targetFilial);
                    logger.info(`Transferências em trânsito para ${targetFilial}: ${transfers.length} itens`);
                }
            } catch (transferErr) {
                logger.warn(`Não foi possível buscar transferências para ${targetFilial}: ${transferErr.message}`);
            }
            
            // 2. Gerar Excel (passando transferências)
            const filePath = await logisticsExcelService.generateLogisticsExcel(data, transfers);

            if (isFriday) {
                // Salvar weekItems no novo snapshot
                newSnapshot[targetFilial] = data.weekItems;
            }

            // 3. Montar mensagem de resumo com volume diário
            const dayMappings = {
                'Segunda-Feira': { abbrev: 'Seg', offset: 0 },
                'Terça-Feira': { abbrev: 'Ter', offset: 1 },
                'Quarta-Feira': { abbrev: 'Qua', offset: 2 },
                'Quinta-Feira': { abbrev: 'Qui', offset: 3 },
                'Sexta-Feira': { abbrev: 'Sex', offset: 4 }
            };

            const startOfWeek = data.startOfWeek || new Date();
            const dailySummaryLines = [];
            const daysOrdered = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira'];
            
            daysOrdered.forEach(d => {
                const subtotalRow = data.cronograma.find(r => r.dia === d && r.isSubtotal);
                const mapping = dayMappings[d];
                let dayLabel = d;
                if (mapping && startOfWeek) {
                    const dateOfSlot = new Date(startOfWeek);
                    dateOfSlot.setDate(startOfWeek.getDate() + mapping.offset);
                    const dStr = String(dateOfSlot.getDate()).padStart(2, '0');
                    const mStr = String(dateOfSlot.getMonth() + 1).padStart(2, '0');
                    dayLabel = `${mapping.abbrev} ${dStr}/${mStr}`;
                }
                if (subtotalRow && subtotalRow.volumeM3 > 0) {
                    dailySummaryLines.push(`• *${dayLabel}:* ${subtotalRow.volumeM3.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³ (${Math.round(subtotalRow.caixas).toLocaleString('pt-BR')} cx)`);
                } else {
                    dailySummaryLines.push(`• *${dayLabel}:* —`);
                }
            });
            const dailySummaryText = dailySummaryLines.join('\n');

            const formatShortDate = (d) => {
                if (!d) return '';
                const dObj = new Date(d);
                const dayStr = String(dObj.getDate()).padStart(2, '0');
                const monthStr = String(dObj.getMonth() + 1).padStart(2, '0');
                const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                return `${daysOfWeek[dObj.getDay()]} ${dayStr}/${monthStr}`;
            };
            const weekLabel = (data.startOfWeek && data.endOfWeek)
                ? `${formatShortDate(data.startOfWeek)} a ${formatShortDate(data.endOfWeek)}`
                : 'Segunda a Sexta-Feira';

            const reportTypeLabel = isFriday ? 'Relatório Oficial de Sexta-Feira' : 'Atualização de Quarta-Feira';
            const label = filialLabels[targetFilial] || targetFilial;
            let caption = `📊 *Relatório de Inteligência Logística — ${label}* (${reportTypeLabel})\n\n` +
                `📅 *Semana de Previsão:* ${weekLabel}\n` +
                `📦 *Pedidos da Semana:* ${data.kpis.totalPedidosSemana}\n` +
                `🔄 *Volume de Itens:* ${data.kpis.totalItensSemana.toLocaleString('pt-BR')} un. (${data.kpis.totalVolumeSemana.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³)\n` +
                `🚨 *Itens Estoque Zero:* ${data.kpis.totalUrgentes}\n` +
                `⚠️ *Itens Sem Endereço:* ${data.kpis.totalSemEndereco}\n\n` +
                `📅 *Volume Previsto por Dia:*\n${dailySummaryText}\n\n`;

            if (!isFriday) {
                // Quarta-Feira: compara os dados atuais com o snapshot de sexta-feira
                const oldItems = snapshot[targetFilial] || [];
                const diffText = compareAndGenerateDiffText(data.weekItems, oldItems);
                caption += diffText;
            }

            // Bloco de transferências para a mensagem WhatsApp
            if (transfers && transfers.length > 0) {
                // Agrupar por número de transferência
                const grouped = {};
                transfers.forEach(t => {
                    const key = t.NUMTRANSVENDA;
                    if (!grouped[key]) {
                        grouped[key] = { numtrans: key, origem: t.CODFILIALORIGEM, dias: t.DIAS_EM_TRANSITO, itens: 0, caixas: 0 };
                    }
                    grouped[key].itens += t.QTTRANSF || 0;
                    grouped[key].caixas += t.QTD_CAIXAS || 0;
                });
                const transLines = Object.values(grouped).map(g => {
                    const diasStr = g.dias !== null ? `${g.dias}d` : '?';
                    const origemLabel = { '20': 'DF-CD', '6': 'DF-Loja', '21': 'GO', '22': 'TO', '23': 'MS' }[String(g.origem)] || `F${g.origem}`;
                    const alerta = g.dias >= 7 ? ' ⚠️' : '';
                    return `• Transf. ${g.numtrans} (${origemLabel}) — ${Math.round(g.itens).toLocaleString('pt-BR')} un. / ${g.caixas.toLocaleString('pt-BR', {minimumFractionDigits:1,maximumFractionDigits:1})} cx | Em trânsito: ${diasStr}${alerta}`;
                });
                caption += `\n🚚 *Transferências em Trânsito (${Object.keys(grouped).length}):*\n${transLines.join('\n')}\n\n`;
            }

            caption += `_Planilha completa em anexo para o planejamento do recebimento e descarga._`;


            // 4. Enviar mensagem e anexo para cada número
            let sentCount = 0;
            for (const num of numbers) {
                try {
                    const sent = await whatsapp.sendFileToNumber(num, filePath, caption);
                    if (sent) {
                        sentCount++;
                        logger.info(`Relatório logístico enviado com sucesso para ${num}`);
                    }
                } catch (err) {
                    logger.error(`Erro ao enviar relatório logístico para ${num}: ${err.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 2000)); // Delay seguro
            }

            // 5. Enviar por E-mail
            try {
                const oldItems = isFriday ? [] : (snapshot[targetFilial] || []);
                const rawDiffText = isFriday ? '' : compareAndGenerateDiffText(data.weekItems, oldItems);
                await sendEmailReport(data, isFriday, rawDiffText, filePath, transfers);
            } catch (emailErr) {
                logger.error(`Erro ao disparar e-mail de logística da filial ${targetFilial}: ${emailErr.message}`);
            }

            results.push({
                filial: targetFilial,
                success: true,
                sentCount,
                totalTarget: numbers.length
            });

        } catch (err) {
            logger.error(`Erro ao processar filial ${targetFilial}: ${err.message}`);
            results.push({
                filial: targetFilial,
                success: false,
                error: err.message
            });
        }
    }

    if (isFriday) {
        saveSnapshot(newSnapshot);
    }

    return {
        success: true,
        isFriday,
        results
    };
}

/**
 * Inicializa os agendadores cron para Inteligência Logística
 */
function initScheduler() {
    if (fridayJob) {
        fridayJob.stop();
        logger.info('⏹️ Cron anterior de logística de sexta-feira finalizado.');
    }
    if (wednesdayJob) {
        wednesdayJob.stop();
        logger.info('⏹️ Cron anterior de logística de quarta-feira finalizado.');
    }

    // Sexta-Feira às 16:00: Forecast offset=1, envia e salva snapshot
    try {
        fridayJob = new CronJob('00 16 * * 5', async () => {
            try {
                await runLogisticsReport(true);
            } catch (err) {
                logger.error(`❌ Falha na execução agendada do relatório logístico de sexta-feira: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');
        fridayJob.start();
        logger.info('🚀 Cron job de logística (Sexta-Feira 16:00) inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de logística de sexta-feira: ${e.message}`);
    }

    // Quarta-Feira às 07:30: Forecast offset=0, compara com o snapshot e envia
    try {
        wednesdayJob = new CronJob('30 07 * * 3', async () => {
            try {
                await runLogisticsReport(false);
            } catch (err) {
                logger.error(`❌ Falha na execução agendada do relatório logístico de quarta-feira: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');
        wednesdayJob.start();
        logger.info('🚀 Cron job de logística (Quarta-Feira 07:30) inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de logística de quarta-feira: ${e.message}`);
    }
}

module.exports = {
    initScheduler,
    runLogisticsReport,
    compareAndGenerateDiffText,
    loadSnapshot,
    saveSnapshot
};
