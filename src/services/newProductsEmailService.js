const nodemailer = require('nodemailer');
const { CronJob } = require('cron');
const { getConnection, oracledb } = require('../config/database');
const googleSheetsService = require('./googleSheetsService');
const logger = require('../utils/logger');
const configManager = require('../utils/configManager');

let cronJob = null;

/**
 * Consulta o banco Oracle buscando os produtos cadastrados no dia anterior
 * @returns {Promise<Array>} Lista de novos produtos
 */
/**
 * Consulta o banco Oracle buscando os produtos cadastrados no período retrativo
 * @param {number|null} daysToLookBack Número de dias retroativos customizado (opcional)
 * @returns {Promise<Array>} Lista de novos produtos
 */
async function getNewProductsYesterday(daysToLookBack = null) {
    let connection;
    try {
        connection = await getConnection();
        
        // Se for segunda-feira, busca de sexta-feira a domingo (últimos 3 dias)
        // Caso contrário, busca apenas do dia anterior (1 dia)
        let days;
        if (daysToLookBack !== null) {
            days = daysToLookBack;
        } else {
            const isMonday = new Date().getDay() === 1;
            days = isMonday ? 3 : 1;
        }
        
        // Se passarmos dias específicos para teste/carga manual, incluímos também produtos cadastrados hoje
        const includeToday = daysToLookBack !== null;
        
        const sql = `
            SELECT 
                CODPROD, 
                DESCRICAO, 
                NOMEECOMMERCE, 
                DIRFOTOPROD, 
                CODFORNEC, 
                TO_CHAR(DTCADASTRO, 'DD/MM/YYYY') AS DTCADASTRO,
                (SELECT FANTASIA FROM PCFORNEC WHERE CODFORNEC = PCPRODUT.CODFORNEC) AS FORNECEDOR
            FROM PCPRODUT
            WHERE DTEXCLUSAO IS NULL
              AND TRUNC(DTCADASTRO) >= TRUNC(SYSDATE) - :days
              ${includeToday ? '' : 'AND TRUNC(DTCADASTRO) < TRUNC(SYSDATE)'}
            ORDER BY PCPRODUT.DTCADASTRO ASC, CODFORNEC, DESCRICAO
        `;
        
        const result = await connection.execute(sql, { days }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = result.rows || [];
        
        // Deduplica produtos por modelo e cor para evitar listar vários tamanhos
        const seen = new Set();
        const uniqueProducts = [];
        for (const p of rows) {
            const desc = p.DESCRICAO || '';
            const cleanDesc = desc.toUpperCase()
                .replace(/\s+N\.?\s*\d+(?:\/\d+)?\s*$/, '')
                .trim();
            const key = `${cleanDesc}_${p.CODFORNEC}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueProducts.push(p);
            }
        }
        
        return uniqueProducts;
    } catch (err) {
        logger.error(`❌ Erro ao consultar novos produtos no Oracle: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Monta o corpo HTML do e-mail com layout premium
 * @param {Array} products Lista de produtos
 * @param {string} dateStr Data formatada
 * @param {string} sheetsViewUrl URL de visualização da planilha
 * @returns {string} HTML final do e-mail
 */
function buildHtmlEmail(products, dateStr, sheetsViewUrl = '') {
    const total = products.length;
    
    let rowsHtml = '';
    products.forEach(p => {
        rowsHtml += `
            <tr>
                <td style="font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 13px;">${p.CODPROD}</td>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 13px; font-weight: 500;">${p.DESCRICAO || ''}</td>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 13px; color: #475569;">${p.NOMEECOMMERCE || '-'}</td>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 13px; color: #475569;">
                    <span style="font-size: 11px; background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #64748b; margin-right: 4px;">
                        ${p.CODFORNEC}
                    </span>
                    ${p.FORNECEDOR || 'N/A'}
                </td>
                <td class="photo-path" style="border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 11px; font-family: 'Courier New', Courier, monospace; color: #64748b; max-width: 180px; word-break: break-all;">
                    ${p.DIRFOTOPROD || '-'}
                </td>
            </tr>
        `;
    });

    const sheetsButtonHtml = sheetsViewUrl && !sheetsViewUrl.includes('PLACEHOLDER') ? `
        <div style="text-align: center; margin: 25px 0;">
            <a href="${sheetsViewUrl}" target="_blank" style="display: inline-block; background-color: #002bf0; color: #ffffff; font-size: 14px; font-weight: bold; padding: 12px 24px; border-radius: 6px; text-decoration: none; box-shadow: 0 4px 6px -1px rgba(0, 43, 240, 0.25);">
                📊 Acessar Planilha e Revisar Produtos
            </a>
        </div>
    ` : '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
            .container { max-width: 800px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); padding: 30px; margin: 0 auto; border-top: 4px solid #002bf0; }
            .header { text-align: center; margin-bottom: 25px; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
            .title { color: #0f172a; font-size: 20px; font-weight: 700; margin: 0; letter-spacing: 0.5px; }
            .subtitle { color: #64748b; font-size: 13px; margin-top: 6px; }
            .badge { display: inline-block; background-color: #002bf0; color: #ffffff; font-size: 13px; font-weight: bold; padding: 4px 14px; border-radius: 50px; margin-top: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background-color: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 12.5px; }
            .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2 class="title">RELATÓRIO DE NOVOS PRODUTOS CADASTRADOS</h2>
                <p class="subtitle">Gerado em: ${dateStr}</p>
                <span class="badge">${total} Produto(s) Novo(s)</span>
            </div>
            
            ${sheetsButtonHtml}
            
            <table>
                <thead>
                    <tr>
                        <th style="width: 80px;">Cód. Prod</th>
                        <th>Descrição</th>
                        <th>Nome E-commerce</th>
                        <th>Fornecedor</th>
                        <th>Diretório de Fotos</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            
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
 * Monta o corpo HTML do e-mail de alerta de pendências
 * @param {Array} pendingProducts Lista amostra de produtos pendentes
 * @param {number} pendingCount Total de produtos pendentes
 * @param {string} sheetsViewUrl URL da planilha
 * @returns {string} HTML final
 */
function buildHtmlPendingEmail(pendingProducts, pendingCount, sheetsViewUrl = '') {
    let rowsHtml = '';
    pendingProducts.forEach(p => {
        rowsHtml += `
            <tr>
                <td style="font-weight: 600; color: #ef4444; border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 13px;">${p.CODPROD}</td>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 13px; font-weight: 500;">${p.DESCRICAO || ''}</td>
                <td style="border-bottom: 1px solid #f1f5f9; padding: 12px; font-size: 11px; font-weight: bold; color: #dc2626; text-transform: uppercase;">Aguardando Revisão</td>
            </tr>
        `;
    });

    const sheetsButtonHtml = sheetsViewUrl && !sheetsViewUrl.includes('PLACEHOLDER') ? `
        <div style="text-align: center; margin: 25px 0;">
            <a href="${sheetsViewUrl}" target="_blank" style="display: inline-block; background-color: #ef4444; color: #ffffff; font-size: 14px; font-weight: bold; padding: 12px 24px; border-radius: 6px; text-decoration: none; box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.25);">
                📊 Acessar Planilha e Revisar Pendências
            </a>
        </div>
    ` : '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
            .container { max-width: 800px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); padding: 30px; margin: 0 auto; border-top: 4px solid #ef4444; }
            .header { text-align: center; margin-bottom: 25px; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
            .title { color: #0f172a; font-size: 20px; font-weight: 700; margin: 0; letter-spacing: 0.5px; }
            .subtitle { color: #64748b; font-size: 13px; margin-top: 6px; }
            .badge { display: inline-block; background-color: #ef4444; color: #ffffff; font-size: 13px; font-weight: bold; padding: 4px 14px; border-radius: 50px; margin-top: 12px; }
            .alert-box { background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; padding: 16px; margin: 20px 0; color: #991b1b; font-size: 13.5px; text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background-color: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; font-size: 12.5px; }
            .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2 class="title">⚠️ PENDÊNCIA DE REVISÃO DE NOVOS PRODUTOS</h2>
                <p class="subtitle">Verificação em: ${new Date().toLocaleDateString('pt-BR')}</p>
                <span class="badge">${pendingCount} Produto(s) Pendente(s)</span>
            </div>
            
            <div class="alert-box">
                <strong>Atenção:</strong> Não foram identificados novos produtos cadastrados no dia anterior. 
                No entanto, constatou-se que existem <strong>${pendingCount} produto(s)</strong> aguardando sua revisão na planilha.
            </div>

            ${sheetsButtonHtml}
            
            <h4 style="color: #334155; margin-bottom: 8px;">Amostra de Itens Pendentes (até 50 itens):</h4>
            <table>
                <thead>
                    <tr>
                        <th style="width: 100px;">Cód. Prod</th>
                        <th>Descrição</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            
            <div class="footer">
                <p>Este alerta foi gerado automaticamente pelo Brago App System.</p>
                <p>© 2026 Brago Distribuidora. Todos os direitos reservados.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Envia o relatório de novos produtos cadastrados ontem por e-mail, ou alerta de pendências
 * @param {boolean} force Se true, força a geração/envio do relatório normal de produtos
 * @param {number|null} daysToLookBack Quantidade customizada de dias retroativos (opcional)
 * @returns {Promise<{success: boolean, message: string, skipped?: boolean, sheets?: Object}>}
 */
async function sendNewProductsReport(force = false, daysToLookBack = null) {
    logger.info('📋 Iniciando geração do Relatório de Novos Produtos...');
    
    let products;
    try {
        products = await getNewProductsYesterday(daysToLookBack);
    } catch (e) {
        logger.error(`❌ Erro ao obter novos produtos: ${e.message}`);
        throw e;
    }

    const dateStr = new Date().toLocaleDateString('pt-BR');
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fullDateStr = `${dateStr} às ${timeStr}`;
    const sheetsViewUrl = process.env.GOOGLE_SHEETS_VIEW_URL;

    // Configura o transportador SMTP
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    // CASO 1: Não há novos produtos no Oracle
    if (products.length === 0) {
        logger.info('⚠️ Nenhum produto novo cadastrado no período. Verificando pendências na planilha...');
        
        let pendingResult;
        try {
            pendingResult = await googleSheetsService.checkPendingProducts();
        } catch (e) {
            logger.error(`⚠️ Falha ao verificar pendências na planilha: ${e.message}`);
            return { success: false, message: `Erro ao buscar pendências na planilha: ${e.message}` };
        }

        if (pendingResult.success && pendingResult.pendingCount > 0) {
            logger.info(`🚨 Encontradas ${pendingResult.pendingCount} pendências na planilha. Enviando e-mail de alerta...`);
            
            const htmlBody = buildHtmlPendingEmail(pendingResult.products, pendingResult.pendingCount, sheetsViewUrl);
            const mailOptions = {
                from: `"Brago App System" <${process.env.SMTP_USER}>`,
                to: process.env.EMAIL_TO,
                subject: `⚠️ Pendência de Revisão: ${pendingResult.pendingCount} novos produtos aguardando revisão`,
                html: htmlBody
            };

            try {
                const info = await transporter.sendMail(mailOptions);
                logger.info(`✅ E-mail de pendência enviado: ${info.messageId}`);
                return {
                    success: true,
                    message: `Nenhum produto novo cadastrado. Alerta de pendência enviado com sucesso (${pendingResult.pendingCount} pendentes).`,
                    sheets: pendingResult
                };
            } catch (err) {
                logger.error(`❌ Falha ao enviar e-mail de pendências: ${err.message}`);
                throw err;
            }
        } else {
            logger.info('✅ Nenhuma pendência de revisão encontrada na planilha Google. Nenhuma notificação necessária.');
            return {
                success: true,
                skipped: true,
                message: 'Nenhum novo produto cadastrado e nenhuma pendência de revisão na planilha. Envio de e-mail pulado.',
                sheets: pendingResult
            };
        }
    }

    // CASO 2: Há novos produtos
    // 1. Sincroniza com o Google Planilhas primeiro
    let sheetsResult = { success: false, added: 0, message: 'Não sincronizado' };
    try {
        sheetsResult = await googleSheetsService.sendProductsToSheets(products);
    } catch (e) {
        logger.error(`⚠️ Falha ao sincronizar com Google Planilhas: ${e.message}. Continuando para o envio de e-mail...`);
    }

    // Se não for forçado e nenhum produto inédito foi adicionado na planilha, pula o e-mail diário para evitar spam
    if (!force && sheetsResult.success && sheetsResult.added === 0) {
        logger.info('⚠️ Todos os produtos novos já constavam na planilha. Envio de e-mail pulado.');
        return { success: true, skipped: true, message: 'Todos os produtos já constavam na planilha. E-mail pulado.', sheets: sheetsResult };
    }

    const htmlBody = buildHtmlEmail(products, fullDateStr, sheetsViewUrl);

    // Ajusta assunto baseado se foi sincronizado ou não
    const subject = sheetsResult.success && sheetsResult.added > 0 
        ? `📊 Novos Produtos Planilha — ${dateStr} (+${sheetsResult.added} itens para revisar)`
        : `📊 Relatório de Novos Produtos — ${dateStr} (${products.length} itens)`;

    const mailOptions = {
        from: `"Brago App System" <${process.env.SMTP_USER}>`,
        to: process.env.EMAIL_TO,
        subject: subject,
        html: htmlBody
    };

    try {
        logger.info(`Enviando e-mail de novos produtos para: ${process.env.EMAIL_TO}...`);
        const info = await transporter.sendMail(mailOptions);
        logger.info(`✅ E-mail enviado com sucesso: ${info.messageId}`);
        return { 
            success: true, 
            message: `Planilha sincronizada (${sheetsResult.added} adicionados) e e-mail enviado com sucesso para ${process.env.EMAIL_TO}.`,
            sheets: sheetsResult
        };
    } catch (err) {
        logger.error(`❌ Falha ao enviar e-mail de novos produtos: ${err.message}`);
        throw err;
    }
}

/**
 * Inicializa o agendador cron diário de envio de e-mails
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const cronTime = configManager.getNewProductsCronTime();
    logger.info(`⏰ Agendando rotina diária de e-mail de novos produtos (cron: "${cronTime}")`);

    try {
        cronJob = CronJob.from({
            cronTime: cronTime,
            onTick: async () => {
                logger.info('⏰ Cron do Relatório de Novos Produtos por E-mail ativado.');
                try {
                    await sendNewProductsReport(false);
                } catch (err) {
                    logger.error(`Erro ao rodar cron de e-mail de novos produtos: ${err.message}`);
                }
            },
            start: true,
            timeZone: "America/Sao_Paulo"
        });

        logger.info('🚀 Cron job de e-mail de novos produtos inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de e-mail de novos produtos: ${e.message}`);
    }
}

module.exports = {
    getNewProductsYesterday,
    sendNewProductsReport,
    initScheduler
};
