const { getConnection, oracledb } = require('../config/database');
const whatsapp = require('./whatsappService');
const sentTracker = require('../utils/sentTracker');
const logger = require('../utils/logger');
const { CronJob } = require('cron');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const CAMPAIGNS_FILE = path.join(__dirname, '..', '..', 'data', 'campaigns.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

// Cache para armazenar os cron jobs ativos das campanhas agendadas
let activeCronJobs = {};

/**
 * Garante que os diretórios necessários existam
 */
function ensureDirectories() {
    const dataDir = path.dirname(CAMPAIGNS_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
}

/**
 * Retorna todas as campanhas cadastradas
 */
function getCampaigns() {
    ensureDirectories();
    try {
        if (fs.existsSync(CAMPAIGNS_FILE)) {
            const content = fs.readFileSync(CAMPAIGNS_FILE, 'utf8');
            return JSON.parse(content);
        }
    } catch (err) {
        logger.error(`Erro ao ler campaigns.json: ${err.message}`);
    }
    return [];
}

/**
 * Salva a lista de campanhas no arquivo JSON
 */
function saveCampaigns(campaigns) {
    ensureDirectories();
    try {
        fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2), 'utf8');
        return true;
    } catch (err) {
        logger.error(`Erro ao salvar campaigns.json: ${err.message}`);
        return false;
    }
}

/**
 * Cria ou atualiza uma campanha
 */
function createOrUpdateCampaign(campaignData) {
    ensureDirectories();
    const campaigns = getCampaigns();
    
    let isNew = !campaignData.id;
    let id = campaignData.id || `camp-${Date.now()}`;
    
    let campaign = campaigns.find(c => c.id === id);
    
    if (!campaign) {
        campaign = { id };
        campaigns.push(campaign);
    }
    
    campaign.name = campaignData.name || 'Nova Campanha';
    campaign.selectQuery = campaignData.selectQuery || '';
    campaign.excelQuery = campaignData.excelQuery || '';
    campaign.personalizedText = campaignData.personalizedText || '';
    campaign.rowTemplate = campaignData.rowTemplate || '';
    campaign.sendType = campaignData.sendType || 'consolidated'; // consolidated | individual
    campaign.recipients = Array.isArray(campaignData.recipients) 
        ? campaignData.recipients 
        : (campaignData.recipients ? campaignData.recipients.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length >= 8) : []);
    campaign.phoneColumn = (campaignData.phoneColumn || '').toUpperCase().trim();
    campaign.cronTime = campaignData.cronTime || '';
    campaign.active = campaignData.active !== false;
    campaign.excelAdmins = Array.isArray(campaignData.excelAdmins)
        ? campaignData.excelAdmins
        : (campaignData.excelAdmins ? campaignData.excelAdmins.split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(n => n.length >= 8) : []);
    
    
    // Processamento da imagem em base64 se enviada
    if (campaignData.imageData && campaignData.imageName) {
        try {
            const ext = path.extname(campaignData.imageName) || '.png';
            const fileName = `campaign_${id}${ext}`;
            const filePath = path.join(UPLOADS_DIR, fileName);
            
            // Remove cabeçalho do base64 se presente (data:image/png;base64,...)
            const base64Data = campaignData.imageData.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            
            fs.writeFileSync(filePath, buffer);
            
            campaign.imageName = fileName;
            campaign.imagePath = filePath;
            logger.info(`Imagem salva para campanha ${id}: ${fileName}`);
        } catch (imgErr) {
            logger.error(`Erro ao salvar imagem da campanha ${id}: ${imgErr.message}`);
        }
    } else if (campaignData.imageName && !campaignData.imageData && campaignData.imageName.startsWith('campaign_')) {
        // Se estamos duplicando ou mantendo uma imagem existente sem enviar novo base64
        try {
            const srcPath = path.join(UPLOADS_DIR, campaignData.imageName);
            if (fs.existsSync(srcPath)) {
                const ext = path.extname(campaignData.imageName) || '.png';
                const fileName = `campaign_${id}${ext}`;
                const filePath = path.join(UPLOADS_DIR, fileName);
                
                // Só copia se for um arquivo de destino diferente (para evitar copiar sobre si mesmo na edição)
                if (srcPath !== filePath) {
                    fs.copyFileSync(srcPath, filePath);
                    campaign.imageName = fileName;
                    campaign.imagePath = filePath;
                    logger.info(`Imagem copiada/duplicada para campanha ${id}: ${fileName}`);
                } else {
                    // Mantém a imagem atual na edição
                    campaign.imageName = campaignData.imageName;
                    campaign.imagePath = filePath;
                }
            }
        } catch (copyErr) {
            logger.error(`Erro ao copiar imagem para campanha ${id}: ${copyErr.message}`);
        }
    } else if (campaignData.imageName === null || campaignData.imageName === '') {
        // Se explicitamente removida
        if (campaign.imageName) {
            const filePath = path.join(UPLOADS_DIR, campaign.imageName);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        }
        campaign.imageName = '';
        campaign.imagePath = '';
    }

    saveCampaigns(campaigns);
    
    // Atualiza agendadores
    initScheduler();
    
    return campaign;
}

/**
 * Exclui uma campanha
 */
function deleteCampaign(id) {
    const campaigns = getCampaigns();
    const index = campaigns.findIndex(c => c.id === id);
    
    if (index !== -1) {
        const campaign = campaigns[index];
        
        // Remove arquivo de imagem associado
        if (campaign.imageName) {
            const filePath = path.join(UPLOADS_DIR, campaign.imageName);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    logger.info(`Imagem excluída: ${filePath}`);
                } catch (e) {
                    logger.error(`Erro ao deletar imagem física ${campaign.imageName}: ${e.message}`);
                }
            }
        }
        
        campaigns.splice(index, 1);
        saveCampaigns(campaigns);
        
        // Atualiza agendadores
        initScheduler();
        return true;
    }
    return false;
}

/**
 * Executa uma query SQL de teste no Oracle com limite de 5 linhas
 */
async function testQuery(selectQuery) {
    if (!selectQuery || selectQuery.trim() === '') {
        throw new Error('A query SQL não pode estar vazia.');
    }
    
    // Remove ponto e vírgula no final se houver
    let cleanQuery = selectQuery.trim().replace(/;$/, '');
    
    // Envolve a query em uma paginação simples para garantir limite de 5 registros
    const wrappedQuery = `
        SELECT * FROM (
            ${cleanQuery}
        ) WHERE ROWNUM <= 5
    `;
    
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(wrappedQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        const rows = result.rows || [];
        const columns = result.metaData ? result.metaData.map(m => m.name) : [];
        
        return {
            columns,
            rows
        };
    } catch (err) {
        logger.error(`Erro ao testar query Oracle: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) {}
        }
    }
}

/**
 * Substitui os placeholders {COLUNA} pelos valores da linha correspondente
 */
function replacePlaceholders(templateText, row) {
    let text = templateText;
    for (const [key, val] of Object.entries(row)) {
        const placeholder = new RegExp(`\\{${key}\\}`, 'gi');
        const displayVal = val !== null && val !== undefined ? String(val) : '';
        text = text.replace(placeholder, displayVal);
    }
    return text;
}

/**
 * Formata os resultados de uma query usando o rowTemplate
 */
function formatQueryResults(rows, rowTemplate) {
    if (rows.length === 0) return '';
    
    if (rowTemplate && rowTemplate.trim() !== '') {
        return rows.map(row => replacePlaceholders(rowTemplate, row)).join('\n');
    }
    
    // Formatação padrão caso não exista template
    const keys = Object.keys(rows[0]);
    return rows.map(row => {
        return '• ' + keys
            .filter(k => k !== 'TELEFONE' && k !== 'PHONE' && k !== 'CELULAR' && k !== 'CONTATO')
            .map(k => `*${k}:* ${row[k] !== null && row[k] !== undefined ? row[k] : '—'}`)
            .join(' | ');
    }).join('\n');
}

/**
 * Dispara uma campanha imediatamente
 */
async function triggerCampaign(id) {
    logger.info(`🚀 Disparando campanha manual: ${id}`);
    const campaigns = getCampaigns();
    const campaign = campaigns.find(c => c.id === id);
    
    if (!campaign) {
        throw new Error(`Campanha ${id} não encontrada.`);
    }
    
    if (!whatsapp.isClientReady()) {
        throw new Error('O cliente do WhatsApp não está conectado.');
    }
    
    let connection;
    let report = {
        campaignName: campaign.name,
        timestamp: new Date().toISOString(),
        successCount: 0,
        errorCount: 0,
        details: []
    };
    
    try {
        // 1. Executa a query SQL
        let cleanQuery = campaign.selectQuery.trim().replace(/;$/, '');
        connection = await getConnection();
        
        logger.info(`Executando query da campanha ${campaign.name}...`);
        const result = await connection.execute(cleanQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = result.rows || [];
        logger.info(`Query da campanha retornou ${rows.length} registros.`);
        
        if (rows.length === 0) {
            report.details.push({ status: 'info', message: 'A query SQL não retornou nenhuma linha de dados. Disparo encerrado.' });
            return report;
        }
        
        const imagePath = campaign.imageName ? path.join(UPLOADS_DIR, campaign.imageName) : null;
        
        // 2. Processa com base no tipo de envio
        if (campaign.sendType === 'consolidated') {
            // Envio Consolidado: formata todas as linhas em uma única mensagem e envia para a lista fixa de destinatários
            const resultsFormatted = formatQueryResults(rows, campaign.rowTemplate);
            const message = `${campaign.personalizedText}\n\n${resultsFormatted}`.trim();
            
            const targets = campaign.recipients || [];
            if (targets.length === 0) {
                throw new Error('Nenhum destinatário cadastrado para envio consolidado.');
            }
            
            for (const numberOrGroup of targets) {
                try {
                    let sent = false;
                    const isGroup = numberOrGroup.length < 8 || isNaN(numberOrGroup); // se for uma string (nome do grupo)
                    
                    if (imagePath && fs.existsSync(imagePath)) {
                        if (isGroup) {
                            sent = await whatsapp.sendFileToGroup(numberOrGroup, imagePath, message, { campaignId: id, type: 'campaign_consolidated' });
                        } else {
                            sent = await whatsapp.sendFileToNumber(numberOrGroup, imagePath, message, { campaignId: id, type: 'campaign_consolidated' });
                        }
                    } else {
                        if (isGroup) {
                            sent = await whatsapp.sendToGroup(numberOrGroup, message, rows.length, { campaignId: id, type: 'campaign_consolidated' });
                        } else {
                            sent = await whatsapp.sendToNumber(numberOrGroup, message, rows.length, { campaignId: id, type: 'campaign_consolidated' });
                        }
                    }
                    
                    if (sent) {
                        report.successCount++;
                        report.details.push({ target: numberOrGroup, status: 'success', message: 'Mensagem enviada com sucesso.' });
                    } else {
                        report.errorCount++;
                        report.details.push({ target: numberOrGroup, status: 'failed', message: 'Falha no envio pelo WhatsAppService.' });
                    }
                } catch (sendErr) {
                    report.errorCount++;
                    report.details.push({ target: numberOrGroup, status: 'failed', message: sendErr.message });
                }
            }
            
        } else {
            // Envio Individual Dinâmico: agrupa os dados pelo número do telefone e envia personalizado
            const phoneCol = campaign.phoneColumn || 'TELEFONE';
            
            // Verifica se a coluna de telefone existe no resultado
            if (rows.length > 0 && !(phoneCol in rows[0])) {
                throw new Error(`A coluna de telefone configurada ("${phoneCol}") não existe no resultado da query SQL. Colunas disponíveis: ${Object.keys(rows[0]).join(', ')}`);
            }
            
            // Agrupar linhas por número de telefone
            const groupedByPhone = {};
            for (const row of rows) {
                let rawPhone = String(row[phoneCol]).trim().replace(/\D/g, '');
                if (rawPhone.length < 8) continue; // ignora telefones inválidos
                
                // Formata número BR (adiciona 55 se faltar)
                if (rawPhone.length <= 11 && !rawPhone.startsWith('55')) {
                    rawPhone = '55' + rawPhone;
                }
                
                if (!groupedByPhone[rawPhone]) {
                    groupedByPhone[rawPhone] = [];
                }
                groupedByPhone[rawPhone].push(row);
            }
            
            const phoneList = Object.keys(groupedByPhone);
            if (phoneList.length === 0) {
                report.details.push({ status: 'warning', message: 'Nenhum telefone válido encontrado na coluna especificada.' });
                return report;
            }
            
            for (const phone of phoneList) {
                try {
                    const clientRows = groupedByPhone[phone];
                    const firstRow = clientRows[0];
                    
                    // Renderiza o texto personalizado principal com placeholders baseados na primeira linha
                    const headerText = replacePlaceholders(campaign.personalizedText, firstRow);
                    
                    // Formata as linhas de detalhes
                    const detailsText = formatQueryResults(clientRows, campaign.rowTemplate);
                    const message = `${headerText}\n\n${detailsText}`.trim();
                    
                    let sent = false;
                    if (imagePath && fs.existsSync(imagePath)) {
                        sent = await whatsapp.sendFileToNumber(phone, imagePath, message, { campaignId: id, clientData: firstRow, type: 'campaign_individual' });
                    } else {
                        sent = await whatsapp.sendToNumber(phone, message, clientRows.length, { campaignId: id, clientData: firstRow, type: 'campaign_individual' });
                    }
                    
                    if (sent) {
                        report.successCount++;
                        report.details.push({ target: phone, status: 'success', message: `Enviado com sucesso (${clientRows.length} linhas de dados)` });
                    } else {
                        report.errorCount++;
                        report.details.push({ target: phone, status: 'failed', message: 'Falha no envio pelo WhatsAppService.' });
                    }
                } catch (sendErr) {
                    report.errorCount++;
                    report.details.push({ target: phone, status: 'failed', message: sendErr.message });
                }
            }
        }
        
    } catch (err) {
        logger.error(`Erro crítico ao processar campanha ${campaign.name}: ${err.message}`);
        report.details.push({ status: 'error', message: `Erro fatal: ${err.message}` });
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) {}
        }
        
        // Registra o disparo no log histórico
        saveCampaignExecutionLog(id, report);
    }
    
    return report;
}

/**
 * Salva o log de execução de disparo da campanha
 */
function saveCampaignExecutionLog(campaignId, report) {
    try {
        const logFile = path.join(__dirname, '..', '..', 'data', 'campaign_logs.json');
        let logs = [];
        if (fs.existsSync(logFile)) {
            try {
                logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
            } catch (e) {}
        }
        
        logs.unshift({
            campaignId,
            ...report
        });
        
        // Mantém apenas os últimos 50 disparos
        if (logs.length > 50) {
            logs = logs.slice(0, 50);
        }
        
        fs.writeFileSync(logFile, JSON.stringify(logs, null, 2), 'utf8');
    } catch (err) {
        logger.error(`Erro ao gravar log da campanha: ${err.message}`);
    }
}

/**
 * Obtém o histórico de execução de disparos de campanhas
 */
function getCampaignExecutionLogs(campaignId = null) {
    const logFile = path.join(__dirname, '..', '..', 'data', 'campaign_logs.json');
    if (!fs.existsSync(logFile)) return [];
    try {
        const logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        if (campaignId) {
            return logs.filter(l => l.campaignId === campaignId);
        }
        return logs;
    } catch (err) {
        return [];
    }
}

/**
 * Inicializa os agendadores das campanhas automáticas ativas
 */
function initScheduler() {
    // Para todos os crons ativos atualmente
    Object.keys(activeCronJobs).forEach(id => {
        try {
            activeCronJobs[id].stop();
            delete activeCronJobs[id];
        } catch (e) {}
    });
    
    const campaigns = getCampaigns();
    const activeAgendadas = campaigns.filter(c => c.active && c.cronTime && c.cronTime.trim() !== '');
    
    logger.info(`⏰ Agendando campanhas automáticas. Ativas com Cron: ${activeAgendadas.length}`);
    
    activeAgendadas.forEach(campaign => {
        try {
            const job = CronJob.from({
                cronTime: campaign.cronTime,
                onTick: async () => {
                    logger.info(`⏰ Cron acionado para campanha agendada: ${campaign.name} (${campaign.id})`);
                    try {
                        if (whatsapp.isClientReady()) {
                            await triggerCampaign(campaign.id);
                        } else {
                            logger.warn(`⚠️ WhatsApp desconectado. Campanha automática ${campaign.name} pulada.`);
                        }
                    } catch (err) {
                        logger.error(`Erro ao disparar campanha agendada ${campaign.name}: ${err.message}`);
                    }
                },
                start: true,
                timeZone: "America/Sao_Paulo"
            });
            
            activeCronJobs[campaign.id] = job;
            logger.info(`🚀 Campanha "${campaign.name}" agendada com cron: "${campaign.cronTime}"`);
        } catch (cronErr) {
            logger.error(`❌ Erro ao criar cron para campanha "${campaign.name}": ${cronErr.message}`);
        }
    });
}

/**
 * Executa uma query customizada, gera um arquivo Excel e envia para contatos específicos via WhatsApp
 */
async function sendCustomExcel(selectQuery, recipients, caption = '') {
    if (!selectQuery || selectQuery.trim() === '') {
        throw new Error('A query SQL não pode estar vazia.');
    }
    
    if (!recipients || recipients.length === 0) {
        throw new Error('Nenhum destinatário informado.');
    }
    
    // Converte destinatários se for string separada por vírgula
    let targets = Array.isArray(recipients)
        ? recipients
        : String(recipients).split(/[\n,]+/).map(n => n.trim()).filter(n => n.length > 0);
        
    if (targets.length === 0) {
        throw new Error('Nenhum destinatário válido informado.');
    }
    
    let cleanQuery = selectQuery.trim().replace(/;$/, '');
    
    let connection;
    let filePath;
    try {
        connection = await getConnection();
        logger.info(`Executando query personalizada para exportação Excel...`);
        const result = await connection.execute(cleanQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        const rows = result.rows || [];
        const columns = result.metaData ? result.metaData.map(m => m.name) : [];
        
        if (rows.length === 0) {
            throw new Error('A consulta retornou 0 linhas de dados. Exportação abortada.');
        }
        
        // Gerar planilha Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Consulta SQL');
        
        // Adicionar cabeçalhos formatados
        worksheet.columns = columns.map(col => ({
            header: col,
            key: col,
            width: Math.max(col.length + 4, 15)
        }));
        
        // Estilizar cabeçalho
        const headerRow = worksheet.getRow(1);
        headerRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF5B21B6' } // Roxo/Purple do design
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        
        // Adicionar linhas
        rows.forEach(row => {
            worksheet.addRow(row);
        });
        
        // Auto-fit de largura das colunas
        worksheet.columns.forEach(column => {
            let maxLen = column.header.length;
            column.eachCell({ includeEmpty: true }, cell => {
                const val = cell.value;
                if (val !== null && val !== undefined) {
                    maxLen = Math.max(maxLen, String(val).length);
                }
            });
            column.width = Math.min(maxLen + 4, 50);
        });
        
        // Salvar planilha em arquivo temporário
        const fileName = `relatorio_custom_${Date.now()}.xlsx`;
        filePath = path.join(UPLOADS_DIR, fileName);
        await workbook.xlsx.writeFile(filePath);
        logger.info(`Excel gerado temporariamente em: ${filePath}`);
        
        // Enviar por WhatsApp
        let successCount = 0;
        let errorCount = 0;
        const details = [];
        
        for (const target of targets) {
            try {
                let sent = false;
                const isGroup = target.length < 8 || isNaN(target);
                
                const finalCaption = caption || 'Segue em anexo o relatório customizado solicitado.';
                
                if (isGroup) {
                    sent = await whatsapp.sendFileToGroup(target, filePath, finalCaption, { type: 'custom_excel' });
                } else {
                    // Sanitiza o número se não for grupo
                    const cleanPhone = target.replace(/\D/g, '');
                    if (cleanPhone.length >= 8) {
                        let finalPhone = cleanPhone;
                        if (cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
                            finalPhone = '55' + cleanPhone;
                        }
                        sent = await whatsapp.sendFileToNumber(finalPhone, filePath, finalCaption, { type: 'custom_excel' });
                    } else {
                        throw new Error(`Número inválido: ${target}`);
                    }
                }
                
                if (sent) {
                    successCount++;
                    details.push({ target, status: 'success', message: 'Enviado com sucesso.' });
                } else {
                    errorCount++;
                    details.push({ target, status: 'failed', message: 'Falha no envio via WhatsApp.' });
                }
            } catch (sendErr) {
                errorCount++;
                details.push({ target, status: 'failed', message: sendErr.message });
            }
        }
        
        // Deletar arquivo temporário após o disparo
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    logger.info(`Arquivo temporário excluído: ${filePath}`);
                }
            } catch (e) {
                logger.warn(`Não foi possível apagar arquivo temporário ${filePath}: ${e.message}`);
            }
        }, 5000); // Aguarda 5 segundos para garantir que o WhatsApp leu o arquivo
        
        return {
            success: true,
            totalRows: rows.length,
            successCount,
            errorCount,
            details
        };
        
    } catch (err) {
        logger.error(`Erro ao processar exportação Excel personalizada: ${err.message}`);
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) {}
        }
    }
}

/**
 * Executa a query de uma campanha, gera o Excel e envia para os administradores selecionados
 */
async function triggerCampaignExcel(id) {
    logger.info(`🚀 Disparando exportação de Excel para campanha: ${id}`);
    const campaigns = getCampaigns();
    const campaign = campaigns.find(c => c.id === id);
    
    if (!campaign) {
        throw new Error(`Campanha ${id} não encontrada.`);
    }
    
    if (!whatsapp.isClientReady()) {
        throw new Error('O cliente do WhatsApp não está conectado.');
    }
    
    const targets = campaign.excelAdmins || [];
    if (targets.length === 0) {
        throw new Error('Nenhum administrador de destino selecionado para esta campanha.');
    }
    
    const queryToUse = (campaign.excelQuery && campaign.excelQuery.trim() !== '') ? campaign.excelQuery : campaign.selectQuery;
    let cleanQuery = queryToUse.trim().replace(/;$/, '');
    
    let connection;
    let filePath;
    let report = {
        campaignName: `${campaign.name} (Planilha Excel)`,
        timestamp: new Date().toISOString(),
        successCount: 0,
        errorCount: 0,
        details: []
    };
    
    try {
        connection = await getConnection();
        logger.info(`Executando query da campanha ${campaign.name} para exportação Excel...`);
        const result = await connection.execute(cleanQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        const rows = result.rows || [];
        const columns = result.metaData ? result.metaData.map(m => m.name) : [];
        
        if (rows.length === 0) {
            report.details.push({ status: 'info', message: 'A query SQL não retornou nenhuma linha de dados. Exportação abortada.' });
            return report;
        }
        
        // Gerar planilha Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Consulta SQL');
        
        // Adicionar cabeçalhos formatados
        worksheet.columns = columns.map(col => ({
            header: col,
            key: col,
            width: Math.max(col.length + 4, 15)
        }));
        
        // Estilizar cabeçalho
        const headerRow = worksheet.getRow(1);
        headerRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF3B82F6' } // Azul matching o botão
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        
        // Adicionar linhas
        rows.forEach(row => {
            worksheet.addRow(row);
        });
        
        // Auto-fit de largura das colunas
        worksheet.columns.forEach(column => {
            let maxLen = column.header.length;
            column.eachCell({ includeEmpty: true }, cell => {
                const val = cell.value;
                if (val !== null && val !== undefined) {
                    maxLen = Math.max(maxLen, String(val).length);
                }
            });
            column.width = Math.min(maxLen + 4, 50);
        });
        
        // Salvar planilha em arquivo temporário
        const fileName = `relatorio_campanha_${id}_${Date.now()}.xlsx`;
        filePath = path.join(UPLOADS_DIR, fileName);
        await workbook.xlsx.writeFile(filePath);
        logger.info(`Excel gerado temporariamente em: ${filePath}`);
        
        const finalCaption = `Segue em anexo a planilha Excel da campanha *${campaign.name}*.\n• Total de registros: ${rows.length}`;
        
        for (const target of targets) {
            try {
                let sent = false;
                const isGroup = target.length < 8 || isNaN(target);
                
                if (isGroup) {
                    sent = await whatsapp.sendFileToGroup(target, filePath, finalCaption, { campaignId: id, type: 'campaign_excel' });
                } else {
                    const cleanPhone = target.replace(/\D/g, '');
                    let finalPhone = cleanPhone;
                    if (cleanPhone.length <= 11 && !cleanPhone.startsWith('55')) {
                        finalPhone = '55' + cleanPhone;
                    }
                    sent = await whatsapp.sendFileToNumber(finalPhone, filePath, finalCaption, { campaignId: id, type: 'campaign_excel' });
                }
                
                if (sent) {
                    report.successCount++;
                    report.details.push({ target, status: 'success', message: 'Planilha enviada com sucesso.' });
                } else {
                    report.errorCount++;
                    report.details.push({ target, status: 'failed', message: 'Falha no envio via WhatsApp.' });
                }
            } catch (sendErr) {
                report.errorCount++;
                report.details.push({ target, status: 'failed', message: sendErr.message });
            }
        }
        
        // Deletar arquivo temporário após o disparo
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    logger.info(`Arquivo temporário excluído: ${filePath}`);
                }
            } catch (e) {
                logger.warn(`Não foi possível apagar arquivo temporário ${filePath}: ${e.message}`);
            }
        }, 5000);
        
    } catch (err) {
        logger.error(`Erro ao processar exportação Excel da campanha ${campaign.name}: ${err.message}`);
        report.details.push({ status: 'error', message: `Erro fatal: ${err.message}` });
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) {}
        }
        
        // Registrar logs de campanha
        saveCampaignExecutionLog(id, report);
    }
    
    return report;
}

module.exports = {
    getCampaigns,
    createOrUpdateCampaign,
    deleteCampaign,
    testQuery,
    triggerCampaign,
    triggerCampaignExcel,
    getCampaignExecutionLogs,
    initScheduler,
    sendCustomExcel
};
