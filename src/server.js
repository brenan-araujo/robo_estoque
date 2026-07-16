const express = require('express');
const path = require('path');
const fs = require('fs');
const configManager = require('./utils/configManager');
const sentTracker = require('./utils/sentTracker');
const monitor = require('./services/monitorController');
const logger = require('./utils/logger');
const oracleService = require('./services/oracleService');
const pdfReportService = require('./services/pdfReportService');
const salesPdfService = require('./services/salesPdfService');
const salesOracleService = require('./services/salesOracleService');
const newProductsEmailService = require('./services/newProductsEmailService');
const contactsManager = require('./utils/contactsManager');
const supervisorReportService = require('./services/supervisorReportService');
const ruptureReportService = require('./services/ruptureReportService');
const purchasingReportService = require('./services/purchasingReportService');
const personalizedProductsService = require('./services/personalizedProductsService');
const whatsapp = require('./services/whatsappService');
const logisticsOracleService = require('./services/logisticsOracleService');
const logisticsExcelService = require('./services/logisticsExcelService');
const logisticsReportService = require('./services/logisticsReportService');
const warehouseBlockedReportService = require('./services/warehouseBlockedReportService');
const campaignService = require('./services/campaignService');
const stockLookupService = require('./services/stockLookupService');
const biaSession = require('./utils/biaSession');
const biaIdentity = require('./utils/biaIdentity');

const app = express();
const PORT = process.env.PORT || 3000;

// Habilita CORS para a página local de QR Code
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json({ limit: '10mb' }));


// Servir arquivos estáticos do frontend (pasta src/public)
app.use(express.static(path.join(__dirname, 'public')));

// [GET] Página de QR Code para vincular WhatsApp
app.get('/qr', (req, res) => {
    const status = monitor.getStatus();
    const qrData = status.qrCode || '';
    const isReady = status.whatsappStatus === 'ready';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="20">
<title>QR Code - Bia</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{display:flex;flex-direction:column;justify-content:center;align-items:center;
     min-height:100vh;background:#0f0f0f;font-family:sans-serif;color:#fff}
h2{font-size:22px;margin-bottom:8px}
p{color:#888;font-size:13px;margin-bottom:24px}
.wrap{background:#fff;border-radius:16px;padding:20px;box-shadow:0 0 40px rgba(74,222,128,.3)}
.ok{color:#4ade80;font-size:18px;margin-top:20px}
.info{color:#666;font-size:12px;margin-top:12px}
</style></head>
<body>
${isReady
    ? '<div class="ok">✅ WhatsApp Conectado! A Bia está respondendo.</div>'
    : qrData
        ? `<h2>📱 Escaneie para conectar a Bia</h2>
           <p>WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
           <div class="wrap"><canvas id="qr"></canvas></div>
           <div class="info">Página atualiza automaticamente a cada 20s</div>
           <script>QRCode.toCanvas(document.getElementById('qr'),${JSON.stringify(qrData)},{width:340},function(e){});</script>`
        : '<p>Aguardando QR Code... (recarregando em 20s)</p>'
}
</body></html>`);
});


// [GET] Status geral do monitoramento
app.get('/api/status', (req, res) => {
    try {
        res.json(monitor.getStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Controle de a\u00e7\u00f5es do monitor (start, stop, restart, scan, logout-whatsapp)
app.post('/api/control', async (req, res) => {
    const { action } = req.body;
    try {
        if (action === 'start') {
            // Executa inicializa\u00e7\u00e3o ass\u00edncrona em background para n\u00e3o travar a resposta HTTP
            monitor.start().catch(err => {
                logger.error(`Falha ao iniciar monitor em segundo plano: ${err.message}`);
            });
            return res.json({ message: 'Iniciando monitoramento...', status: monitor.getStatus() });
        } else if (action === 'stop') {
            const status = await monitor.stop();
            return res.json({ message: 'Monitoramento parado.', status });
        } else if (action === 'restart') {
            monitor.restart().catch(err => {
                logger.error(`Falha ao reiniciar monitor em segundo plano: ${err.message}`);
            });
            return res.json({ message: 'Reiniciando monitoramento...', status: monitor.getStatus() });
        } else if (action === 'scan') {
            const scanResult = await monitor.runScan();
            return res.json({ message: 'Consulta manual executada.', scanResult, status: monitor.getStatus() });
        } else if (action === 'logout-whatsapp') {
            const status = await monitor.logoutWhatsApp();
            return res.json({ message: 'WhatsApp desconectado. Sess\u00e3o apagada.', status });
        } else if (action === 'send-supervisor-reports') {
            const result = await supervisorReportService.sendSupervisorReports(true);
            return res.json({
                success: true,
                message: `Relat\u00f3rios PDF de supervisores gerados e enviados. Sucessos: ${result.successCount}, Falhas: ${result.errorCount}`,
                details: result
            });
        } else {
            return res.status(400).json({ error: 'A\u00e7\u00e3o inv\u00e1lida. Use start, stop, restart, scan, send-supervisor-reports ou logout-whatsapp.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Middleware para garantir leitura do body mesmo sem headers de content-type corretos
function rawBodyParser(req, res, next) {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        return next();
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
        req.body = data;
        next();
    });
}

// [POST] Envia mensagem personalizada para um grupo ou número via WhatsApp
app.post('/api/whatsapp/send-message', rawBodyParser, async (req, res) => {
    logger.info(`[Bia] headers no send-message: ${JSON.stringify(req.headers)}`);
    logger.info(`[Bia] body no send-message: ${JSON.stringify(req.body)}`);
    let parsed = req.body || {};
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch(e) { parsed = {}; }
    }
    const { target, message, isGroup } = parsed;
    if (!target || !message) {
        return res.status(400).json({ error: 'Parâmetros "target" e "message" são obrigatórios.' });
    }
    try {
        const whatsapp = require('./services/whatsappService');
        if (!whatsapp.isClientReady()) {
            return res.status(400).json({ error: 'WhatsApp não está inicializado ou conectado no monitor.' });
        }
        let success = false;
        if (isGroup) {
            success = await whatsapp.sendToGroup(target, message);
        } else {
            success = await whatsapp.sendToNumber(target, message);
        }
        return res.json({ success, message: success ? 'Mensagem enviada com sucesso.' : 'Falha ao enviar mensagem.' });
    } catch (err) {
        logger.error(`Erro ao enviar mensagem personalizada: ${err.message}`);
        return res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────
// 🤖 IA BIA — Memória de Conversas por Sessão (WhatsApp + Gemini)
// ─────────────────────────────────────────────────────────────────
const AI_MEMORY_PATH = path.join(__dirname, '..', 'data', 'ai_chat_memory.json');
const BOT_PHONE = process.env.BOT_PHONE_NUMBER || '556296092678';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/bia-whatsapp';

/** Carrega memória do disco ou retorna objeto vazio */
function loadMemory() {
    try {
        if (fs.existsSync(AI_MEMORY_PATH)) {
            return JSON.parse(fs.readFileSync(AI_MEMORY_PATH, 'utf-8'));
        }
    } catch (e) { /* ignora erro de parse */ }
    return {};
}

/** Salva memória no disco */
function saveMemory(mem) {
    try {
        const dir = path.dirname(AI_MEMORY_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(AI_MEMORY_PATH, JSON.stringify(mem, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`Erro ao salvar memória IA: ${e.message}`);
    }
}

// [GET] Buscar histórico de uma sessão
app.get('/api/ai-chat/memory/:sessionId', (req, res) => {
    const mem = loadMemory();
    const session = mem[req.params.sessionId] || { history: [], lastUpdated: null };
    res.json(session);
});

// [POST] Salvar ou atualizar histórico de uma sessão
app.post('/api/ai-chat/memory/:sessionId', rawBodyParser, (req, res) => {
    let parsed = req.body || {};
    // Se o body chegou como string (raw), faz parse manual
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch(e) { parsed = {}; }
    }
    const history = parsed && parsed.history;
    if (!Array.isArray(history)) return res.status(400).json({ error: '"history" deve ser um array.' });
    const mem = loadMemory();
    mem[req.params.sessionId] = { history: history.slice(-20), lastUpdated: new Date().toISOString() };
    saveMemory(mem);
    res.json({ success: true });
});

// [DELETE] Limpar histórico de todas as sessões antigas (> 24h)
app.delete('/api/ai-chat/memory/cleanup', (req, res) => {
    const mem = loadMemory();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const key of Object.keys(mem)) {
        if (mem[key].lastUpdated && new Date(mem[key].lastUpdated).getTime() < cutoff) {
            delete mem[key]; removed++;
        }
    }
    saveMemory(mem);
    res.json({ success: true, removed });
});

// ─────────────────────────────────────────────────────────────────
// 📋 BIA — Menus: estado da sessão + consulta de estoque por produto
// ─────────────────────────────────────────────────────────────────

// [GET] Estado atual do menu de um telefone
app.get('/api/bia/session/:phone', (req, res) => {
    try {
        res.json(biaSession.getSession(req.params.phone));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Atualiza o menu atual de um telefone ({ menu })
app.post('/api/bia/session/:phone', rawBodyParser, (req, res) => {
    let parsed = req.body || {};
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (e) { parsed = {}; }
    }
    try {
        res.json({ success: true, session: biaSession.setSession(req.params.phone, parsed.menu) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Identifica/autoriza quem está falando com a BIA (allowlist = PCUSUARI/contacts + admins)
app.get('/api/bia/identify/:phone', (req, res) => {
    try {
        res.json(biaIdentity.resolve(req.params.phone));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Consulta estoque + liberação + previsão de chegada de um produto
// Filial: usa ?filial= se informada; senão resolve pelo ?phone= (vendedor).
app.get('/api/estoque/consulta', async (req, res) => {
    const produto = req.query.produto;
    if (!produto) {
        return res.status(400).json({ error: 'Parâmetro "produto" é obrigatório.' });
    }

    let codFilial = req.query.filial;
    let vendedor = null;
    if (!codFilial && req.query.phone) {
        const ident = biaIdentity.resolve(req.query.phone);
        if (ident.authorized) {
            vendedor = { nome: ident.name, role: ident.role, filialFormatada: ident.filial, codFilial: ident.filial, rca: ident.rcaCode };
            if (ident.filial && ident.filial !== 'N/A') codFilial = ident.filial;
        }
    }
    if (!codFilial) {
        // Reconhecido como admin sem filial padrão → Executa consulta consolidadas de todas as filiais
        if (vendedor && vendedor.role === 'admin') {
            try {
                // 1. Busca os matches da filial principal (ou qualquer filial, ex. 20) para obter as correspondências de produtos
                const principalRes = await stockLookupService.consultarProduto({ termo: produto, codFilial: '20' });
                const matches = principalRes.matches || [];

                if (matches.length === 0) {
                    return res.json({ termo: produto, codFilial: 'todas as filiais', matches: [], needsFilial: false, vendedor });
                }
                if (matches.length > 1) {
                    return res.json({ termo: produto, codFilial: 'todas as filiais', matches, needsFilial: false, vendedor });
                }

                // Exatamente 1 match: busca o estoque desse produto nas filiais 20, 21, 22, 23
                const singleMatch = matches[0];
                const codProdExato = singleMatch.codprod;

                const filiais = [
                    { cod: '20', nome: 'DF (20/6)' },
                    { cod: '21', nome: 'GO (21)' },
                    { cod: '22', nome: 'TO (22)' },
                    { cod: '23', nome: 'MS (23)' }
                ];

                const resultados = await Promise.all(filiais.map(async (f) => {
                    try {
                        const resFilial = await stockLookupService.consultarProduto({ termo: String(codProdExato), codFilial: f.cod });
                        const matchFilial = resFilial.matches && resFilial.matches.find(item => item.codprod === codProdExato);
                        return { filialNome: f.nome, match: matchFilial };
                    } catch (err) {
                        logger.error(`[Estoque Admin] Erro ao consultar filial ${f.cod}: ${err.message}`);
                        return { filialNome: f.nome, match: null };
                    }
                }));

                let lines = [];
                for (const r of resultados) {
                    if (r.match) {
                        const status = r.match.status;
                        let info = '';
                        if (status === 'disponivel') {
                            info = `${r.match.estoqueDisponivel} disp. ✅`;
                        } else if (status === 'em_liberacao') {
                            info = `em liberação (${r.match.qtdEmLiberacao}) ⏳`;
                        } else if (status === 'a_caminho') {
                            info = `a caminho (prev: ${r.match.previsaoChegada}) 🚚`;
                        } else {
                            info = 'sem estoque ❌';
                        }
                        lines.push(`\n  • *${r.filialNome}*: ${info}`);
                    } else {
                        lines.push(`\n  • *${r.filialNome}*: sem cadastro/estoque ❌`);
                    }
                }

                const consolidatedMatch = {
                    codprod: codProdExato,
                    descricao: singleMatch.descricao,
                    unidade: singleMatch.unidade || 'un',
                    status: 'disponivel',
                    estoqueDisponivel: lines.join('')
                };

                return res.json({
                    termo: produto,
                    codFilial: 'todas as filiais',
                    matches: [consolidatedMatch],
                    needsFilial: false,
                    vendedor
                });
            } catch (err) {
                logger.error(`[Estoque Admin] Erro geral na consulta admin: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }
        }

        // Caso comum: reconhecido porém sem filial (vendedor normal sem filial vinculada)
        if (vendedor) {
            return res.json({ termo: produto, codFilial: null, matches: [], needsFilial: true, vendedor });
        }
        return res.status(400).json({
            error: 'Filial não informada e telefone não reconhecido. Passe "filial" na consulta.',
            vendedorReconhecido: false,
        });
    }
    // Valida filial como dígitos (é interpolada no SQL).
    if (!/^\d+$/.test(String(codFilial))) {
        return res.status(400).json({ error: 'Filial inválida.' });
    }

    try {
        const resultado = await stockLookupService.consultarProduto({ termo: produto, codFilial });
        res.json({ ...resultado, vendedor });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Buscar configurações vigentes
app.get('/api/settings', (req, res) => {
    try {
        res.json({
            ...configManager.getSettings(),
            env: configManager.getEnvSettings()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Atualizar configura\u00e7\u00f5es vigentes
app.post('/api/settings', (req, res) => {
    try {
        const {
            pollIntervalMinutes,
            arrivalDelayMinutes,
            cutAlertEnabled,
            cutWindowDays,
            cutFallbackNumber,
            notifyNumbers,
            pdfNotifyNumbers,
            salesPdfNotifyNumbers,
            ruptureNotifyNumbers,
            purchasingNotifyNumbers,
            purchasingCronTime,
            filialGroups,
            filialNumbers,
            env,
            pdfCronTime,
            salesPdfCronTime,
            newProductsCronTime,
            supervisorCronTime,
            ruptureCronTime,
            personalizedProductsCronTime,
            logisticsNotifyNumbers,
            logisticsNotifyEmails
        } = req.body;

        // Salva as configurações locais em data/settings.json
        const successJSON = configManager.saveSettings({
            pollIntervalMinutes,
            arrivalDelayMinutes,
            cutAlertEnabled,
            cutWindowDays,
            cutFallbackNumber,
            notifyNumbers,
            pdfNotifyNumbers,
            salesPdfNotifyNumbers,
            ruptureNotifyNumbers,
            purchasingNotifyNumbers,
            purchasingCronTime,
            filialGroups,
            filialNumbers,
            pdfCronTime,
            salesPdfCronTime,
            newProductsCronTime,
            supervisorCronTime,
            ruptureCronTime,
            personalizedProductsCronTime,
            logisticsNotifyNumbers,
            logisticsNotifyEmails
        });
        
        // Salva as configura\u00e7\u00f5es no arquivo .env se passadas
        let successEnv = true;
        if (env) {
            successEnv = configManager.saveEnvSettings({
                ORACLE_USER: env.oracleUser,
                ORACLE_PASS: env.oraclePass,
                ORACLE_CONNECTION_STRING: env.oracleConnectionString,
                ORACLE_CLIENT_DIR: env.oracleClientDir,
                LOG_LEVEL: env.logLevel,
                SMTP_HOST: env.smtpHost,
                SMTP_PORT: env.smtpPort,
                SMTP_SECURE: String(env.smtpSecure),
                SMTP_USER: env.smtpUser,
                SMTP_PASS: env.smtpPass,
                EMAIL_TO: env.emailTo,
                GOOGLE_SHEETS_WEBAPP_URL: env.googleSheetsWebappUrl,
                GOOGLE_SHEETS_VIEW_URL: env.googleSheetsViewUrl
            });
        }
        
        if (successJSON && successEnv) {
            monitor.refreshInterval();
            
            // Recarrega os schedulers ativos para aplicar novas frequências e contatos
            try {
                require('./services/pdfReportService').initScheduler();
                require('./services/salesPdfService').initScheduler();
                require('./services/newProductsEmailService').initScheduler();
                require('./services/supervisorReportService').initScheduler();
                require('./services/ruptureReportService').initScheduler();
                require('./services/purchasingReportService').initScheduler();
                require('./services/personalizedProductsService').initScheduler();
                logger.info('🔄 Todos os agendadores (schedulers) foram reinicializados com sucesso.');
            } catch (sErr) {
                logger.error(`❌ Erro ao reiniciar agendadores: ${sErr.message}`);
            }

            return res.json({ 
                success: true, 
                settings: {
                    ...configManager.getSettings(),
                    env: configManager.getEnvSettings()
                } 
            });
        } else {
            return res.status(400).json({ error: 'Falha ao salvar configurações' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Dados do funil de jornada dos produtos de hoje
app.get('/api/funnel-products', async (req, res) => {
    try {
        const products = await oracleService.getFunnelProducts();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Fila de broadcasts de chegada aguardando o delay configurado
app.get('/api/arrival-queue', (req, res) => {
    try {
        const arrivalQueue = require('./utils/arrivalQueue');
        res.json({
            delayMinutes: configManager.getSettings().arrivalDelayMinutes,
            pending: arrivalQueue.listPending()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] "Enviar agora": dispara um lote da fila antes do horário agendado
app.post('/api/arrival-queue/:id/dispatch', async (req, res) => {
    try {
        const { dispatchBatchNow } = require('./jobs/checkProducts');
        const result = await dispatchBatchNow(req.params.id);
        res.status(result.success ? 200 : 409).json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente a gera\u00e7\u00e3o e o envio do PDF de resumo di\u00e1rio
app.post('/api/send-pdf-report', async (req, res) => {
    try {
        const result = await pdfReportService.sendDailyPdfReport(true);
        res.json({
            success: true,
            message: result.skipped 
                ? 'Nenhuma movimenta\u00e7\u00e3o registrada hoje. Envio pulado.'
                : `Relat\u00f3rio PDF gerado e enviado com sucesso para ${result.successCount} contato(s). Falhas: ${result.errorCount}.`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar envio manual do PDF: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente a gera\u00e7\u00e3o e envio do PDF de vendas di\u00e1rio
app.post('/api/send-sales-report', async (req, res) => {
    const { date } = req.body;
    try {
        let targetDate;
        if (date) {
            const parts = date.split(/[-/]/);
            if (parts.length === 3) {
                targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            } else {
                targetDate = new Date(date);
            }
            if (isNaN(targetDate.getTime())) {
                return res.status(400).json({ error: 'Data inv\u00e1lida. Use o formato YYYY-MM-DD.' });
            }
        } else {
            targetDate = new Date();
        }
        const result = await salesPdfService.sendSalesPdfReport(true, targetDate);
        res.json({
            success: true,
            message: result.skipped
                ? `Nenhuma venda registrada em ${targetDate.toLocaleDateString('pt-BR')}. Envio pulado.`
                : `PDF de vendas de ${targetDate.toLocaleDateString('pt-BR')} gerado e enviado para ${result.successCount} contato(s). Falhas: ${result.errorCount}.`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar envio manual do PDF de vendas: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});// [POST] Dispara manualmente a gera\u00e7\u00e3o e envio do e-mail de novos produtos
app.post('/api/send-new-products-report', async (req, res) => {
    const { days, force } = req.body;
    try {
        const parsedDays = days ? parseInt(days, 10) : null;
        const result = await newProductsEmailService.sendNewProductsReport(force !== false, parsedDays);
        res.json({
            success: true,
            message: result.message,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar envio manual do e-mail de novos produtos: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente a gera\u00e7\u00e3o e envio do relat\u00f3rio de ruptura de estoque
app.post('/api/send-rupture-report', async (req, res) => {
    const { dryRun } = req.body;
    try {
        const isDryRun = dryRun === true || req.query.dryRun === 'true';
        const result = await ruptureReportService.runRuptureReport(isDryRun);
        res.json({
            success: true,
            message: isDryRun
                ? `Relat\u00f3rio de Ruptura (DRY-RUN) gerado com sucesso localmente em: ${result.pdfPath}`
                : `Relat\u00f3rio de Ruptura gerado e enviado com sucesso para ${result.sentCount} contato(s).`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar envio manual do relat\u00f3rio de rupturas: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] Listagem de produtos em ruptura atuais
app.get('/api/ruptures', async (req, res) => {
    try {
        const params = {
            pisoEstoque: configManager.getRupturePisoEstoque(),
            janelaGiro: configManager.getRuptureJanelaGiro(),
            minDiasComVenda: configManager.getRuptureMinDiasComVenda(),
            janelaVendaRecente: configManager.getRuptureJanelaVendaRecente()
        };
        const products = await oracleService.getRuptureProducts(params);
        const history = ruptureReportService.loadHistory();
        
        const todayStr = new Date().toISOString().split('T')[0];
        const enriched = products.map(p => {
            const key = `${p.CODFILIAL}-${p.CODPROD}`;
            let firstSeen = todayStr;
            if (history[key] && history[key].dateFirstSeen) {
                firstSeen = history[key].dateFirstSeen;
            }
            const diffTime = new Date(todayStr) - new Date(firstSeen);
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            return {
                ...p,
                IDADE: diffDays + 1
            };
        });
        
        res.json({
            success: true,
            products: enriched
        });
    } catch (err) {
        logger.error(`Erro ao consultar rupturas via API: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] Dados de vendas em tempo real (JSON)
app.get('/api/sales-data', async (req, res) => {
    const { date } = req.query;
    try {
        let targetDate;
        if (date) {
            const parts = date.split(/[-/]/);
            if (parts.length === 3) {
                targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            } else {
                targetDate = new Date(date);
            }
            if (isNaN(targetDate.getTime())) {
                return res.status(400).json({ error: 'Data inv\u00e1lida. Use o formato YYYY-MM-DD.' });
            }
        } else {
            targetDate = new Date();
        }
        const data = await salesOracleService.getFullSalesReport(targetDate);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Hist\u00f3rico das mensagens enviadas
app.get('/api/sent', (req, res) => {
    try {
        res.json(sentTracker.getSentHistory());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Logs recentes do sistema
app.get('/api/logs', (req, res) => {
    try {
        res.json({ logs: logger.getMemoryLogs() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Obter contatos
app.get('/api/contacts', (req, res) => {
    try {
        res.json(contactsManager.getContacts());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Salvar contatos
app.post('/api/contacts', (req, res) => {
    try {
        const success = contactsManager.saveContacts(req.body);
        if (success) {
            res.json({ success: true, contacts: contactsManager.getContacts() });
        } else {
            res.status(400).json({ error: 'Falha ao salvar contatos' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Resend notifications to a specific number
app.post('/api/resend-notifications', async (req, res) => {
    const { phone, lastUnlockDate } = req.body;
    if (!phone) {
        return res.status(400).json({ error: 'Telefone é obrigatório' });
    }
    
    try {
        logger.info(`re-sending notifications since ${lastUnlockDate} to ${phone}`);
        const rawEntries = await oracleService.getNewEntries(lastUnlockDate);
        if (rawEntries.length === 0) {
            return res.json({ success: true, message: 'Nenhum desbloqueio encontrado para reenviar' });
        }
        
        const grouped = oracleService.groupByFilial(rawEntries);
        let sentCount = 0;
        for (const [codFilial, data] of Object.entries(grouped)) {
            const message = oracleService.formatMessage(codFilial, data);
            if (whatsapp.isClientReady()) {
                const sent = await whatsapp.sendToNumber(phone, message, data.items.length, { codFilial });
                if (sent) sentCount++;
            }
        }
        
        res.json({ success: true, message: `Notificações enviadas com sucesso (${sentCount} mensagens)` });
    } catch (err) {
        logger.error(`Erro ao reenviar notificações para ${phone}: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// CAMPANHAS ENDPOINTS
// ==========================================

// [GET] Listar campanhas e logs
app.get('/api/campaigns', (req, res) => {
    try {
        const campaigns = campaignService.getCampaigns();
        const logs = campaignService.getCampaignExecutionLogs();
        res.json({ success: true, campaigns, logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Criar ou atualizar campanha (com imagem base64)
app.post('/api/campaigns', (req, res) => {
    try {
        const campaign = campaignService.createOrUpdateCampaign(req.body);
        res.json({ success: true, campaign });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [DELETE] Excluir campanha
app.delete('/api/campaigns/:id', (req, res) => {
    try {
        const success = campaignService.deleteCampaign(req.params.id);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Campanha não encontrada.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Testar query SQL no Oracle
app.post('/api/campaigns/test-query', async (req, res) => {
    try {
        const { selectQuery } = req.body;
        const result = await campaignService.testQuery(selectQuery);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// [POST] Executar query customizada, gerar Excel e enviar via WhatsApp
app.post('/api/campaigns/send-custom-excel', async (req, res) => {
    try {
        const { selectQuery, recipients, caption } = req.body;
        const result = await campaignService.sendCustomExcel(selectQuery, recipients, caption);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Disparar campanha imediatamente
app.post('/api/campaigns/:id/trigger', async (req, res) => {
    try {
        const report = await campaignService.triggerCampaign(req.params.id);
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Disparar exportação de Excel de campanha para administradores
app.post('/api/campaigns/:id/trigger-excel', async (req, res) => {
    try {
        const report = await campaignService.triggerCampaignExcel(req.params.id);
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota para servir o painel frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// [POST] Dispara manualmente o relatório de produtos pendentes de cadastro (ION)
app.post('/api/send-ion-report', async (req, res) => {
    try {
        const testPhone = req.body && req.body.testPhone;
        const ionPendingReportService = require('./services/ionPendingReportService');
        const result = await ionPendingReportService.runIonPendingReport(testPhone);
        res.json({
            success: true,
            message: testPhone
                ? `Relatório de produtos pendentes (TESTE) enviado para ${testPhone}.`
                : `Relatório de produtos pendentes enviado para ${result.sentCount} destinatário(s).`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar relatório ION: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente a geração e envio do relatório semanal de compras
app.post('/api/send-purchasing-report', async (req, res) => {
    try {
        const isDryRun = (req.body && req.body.dryRun === true) || req.query.dryRun === 'true';
        const testPhone = req.body && req.body.testPhone;
        const result = await purchasingReportService.runPurchasingReport(isDryRun, testPhone);
        res.json({
            success: true,
            message: isDryRun
                ? `Relatório de Compras (DRY-RUN) gerado com sucesso localmente em: ${result.pdfPath}`
                : testPhone
                    ? `Relatório de Compras (TESTE) enviado para ${testPhone}.`
                    : `Relatório de Compras gerado e enviado com sucesso para ${result.sentCount} contato(s).`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar envio manual do relatório de compras: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente o relatório semanal de metas em PDF
app.post('/api/send-weekly-goals-report', async (req, res) => {
    try {
        const isDryRun = (req.body && req.body.dryRun === true) || req.query.dryRun === 'true';
        const testPhone = req.body && req.body.testPhone;
        const refDate = req.body && req.body.refDate; // opcional: simular outra data (DD/MM/YYYY não; usar ISO)
        const testRcas = req.body && req.body.testRcas; // opcional: array de RCAs p/ amostra de teste
        const weeklyGoalsReportService = require('./services/weeklyGoalsReportService');
        const result = await weeklyGoalsReportService.runWeeklyGoalsReport(isDryRun, testPhone, refDate, testRcas);
        res.json({
            success: true,
            message: isDryRun
                ? `Relatório de Metas Semanal (DRY-RUN) gerado em: ${result.pdfPath}`
                : testPhone
                    ? `Relatório de Metas Semanal (TESTE) enviado para ${testPhone}.`
                    : `Relatório de Metas Semanal enviado (${result.sentCount} envio(s)).`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar relatório semanal de metas: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Envio em massa: cada vendedor recebe o próprio relatório de metas.
// Roda em segundo plano (20–60s entre envios); progresso e resumo final nos logs [MetasMassa].
app.post('/api/send-weekly-goals-mass', async (req, res) => {
    try {
        const isDryRun = (req.body && req.body.dryRun === true) || req.query.dryRun === 'true';
        const refDate = req.body && req.body.refDate; // opcional: simular outra data (ISO)
        const weeklyGoalsReportService = require('./services/weeklyGoalsReportService');
        weeklyGoalsReportService.runMassGoalsSend(isDryRun, refDate)
            .then(r => logger.info(`[MetasMassa] Resultado final: ${JSON.stringify({ enviados: r.enviados, total: r.total, falhas: (r.falhas || []).length, pulados: (r.pulados || []).length })}`))
            .catch(e => logger.error(`[MetasMassa] Erro geral: ${e.message}`));
        res.json({ success: true, message: `Envio em massa${isDryRun ? ' (DRY-RUN)' : ''} iniciado em segundo plano. Acompanhe pelos logs [MetasMassa].` });
    } catch (err) {
        logger.error(`Erro ao iniciar envio em massa de metas: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente a verificação de produtos personalizados
app.post('/api/send-personalized-products-report', async (req, res) => {
    try {
        const isDryRun = (req.body && req.body.dryRun === true) || req.query.dryRun === 'true';
        const testPhone = req.body && req.body.testPhone;
        const vendorFilter = req.body && req.body.vendorFilter;
        const result = await personalizedProductsService.sendPersonalizedProductsAlerts(isDryRun, testPhone, vendorFilter);
        res.json({
            success: true,
            message: isDryRun
                ? `Verificação de Produtos Personalizados (DRY-RUN) concluída com sucesso.`
                : `Verificação de Produtos Personalizados concluída. Envios realizados: ${result.sentCount}.`,
            details: result
        });
    } catch (err) {
        logger.error(`Erro ao disparar verificação de produtos personalizados: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] KPIs de Inteligência Logística para visualização rápida no painel
app.get('/api/logistics/kpis', async (req, res) => {
    try {
        const filial = req.query.filial || '20 + 6';
        logger.info(`Rota /api/logistics/kpis acionada para filial: ${filial}`);
        const data = await logisticsOracleService.getLogisticsData(filial);
        res.json({
            success: true,
            filial: data.filialCode,
            kpis: data.kpis,
            cronograma: data.cronograma,
            topFornecedores: data.topFornecedores,
            alertas: data.alertas
        });
    } catch (err) {
        logger.error(`Erro ao buscar KPIs de logística: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] Gera e faz o download do relatório Excel de Inteligência Logística
app.get('/api/logistics/download', async (req, res) => {
    try {
        const filial = req.query.filial || '20 + 6';
        logger.info(`Rota /api/logistics/download acionada para filial: ${filial}`);
        const data = await logisticsOracleService.getLogisticsData(filial);
        
        let transfers = [];
        try {
            if (filial !== 'GERAL' && filial !== 'ALL') {
                transfers = await logisticsOracleService.getInterBranchTransfers(filial);
            }
        } catch (transErr) {
            logger.warn(`Não foi possível buscar transferências para download de ${filial}: ${transErr.message}`);
        }

        const filePath = await logisticsExcelService.generateLogisticsExcel(data, transfers);
        res.download(filePath, (err) => {
            if (err) {
                logger.error(`Erro ao enviar arquivo de logística para download: ${err.message}`);
            }
        });
    } catch (err) {
        logger.error(`Erro ao baixar relatório de logística: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] Download da planilha de produtos sem cubagem ou zerados
app.get('/api/products/without-cubage/download', async (req, res) => {
    try {
        logger.info('Rota /api/products/without-cubage/download acionada');
        const products = await logisticsOracleService.getProductsWithoutCubage();
        const filePath = await logisticsExcelService.generateProductsWithoutCubageExcel(products);
        res.download(filePath, 'produtos_sem_cubagem.xlsx', (err) => {
            if (err) {
                logger.error(`Erro ao enviar planilha de produtos sem cubagem: ${err.message}`);
            }
        });
    } catch (err) {
        logger.error(`Erro ao baixar produtos sem cubagem: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] Transferências em trânsito entre filiais (pendentes de recebimento no destino)
app.get('/api/logistics/transfers', async (req, res) => {
    try {
        const filial = req.query.filial || '20 + 6';
        logger.info(`Rota /api/logistics/transfers acionada para filial destino: ${filial}`);
        const transfers = await logisticsOracleService.getInterBranchTransfers(filial);
        
        // Agrupar por número de transferência para resumo
        const grouped = {};
        transfers.forEach(t => {
            const key = t.NUMTRANSVENDA;
            if (!grouped[key]) {
                grouped[key] = {
                    NUMTRANSVENDA: t.NUMTRANSVENDA,
                    CODFILIALORIGEM: t.CODFILIALORIGEM,
                    CODFILIALDESTINO: t.CODFILIALDESTINO,
                    DTTRANSF: t.DTTRANSF,
                    DIAS_EM_TRANSITO: t.DIAS_EM_TRANSITO,
                    TOTAL_ITENS: 0,
                    TOTAL_CAIXAS: 0,
                    TOTAL_CUBAGEM: 0,
                    produtos: []
                };
            }
            grouped[key].TOTAL_ITENS += t.QTTRANSF || 0;
            grouped[key].TOTAL_CAIXAS += t.QTD_CAIXAS || 0;
            grouped[key].TOTAL_CUBAGEM += t.CUBAGEM_TOTAL || 0;
            grouped[key].produtos.push({
                CODIGO_PRODUTO: t.CODIGO_PRODUTO,
                DESCRICAO_PRODUTO: t.DESCRICAO_PRODUTO,
                QTTRANSF: t.QTTRANSF,
                QTD_CAIXAS: t.QTD_CAIXAS,
                CUBAGEM_TOTAL: t.CUBAGEM_TOTAL
            });
        });

        const transfersSummary = Object.values(grouped);
        
        res.json({
            success: true,
            filial,
            totalItens: transfers.length,
            totalTransferencias: transfersSummary.length,
            totalCubagem: transfers.reduce((a, t) => a + (t.CUBAGEM_TOTAL || 0), 0),
            transfers: transfersSummary,
            items: transfers
        });
    } catch (err) {
        logger.error(`Erro ao buscar transferências em trânsito: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente o envio do relatório de logística por WhatsApp para números específicos
app.post('/api/logistics/send-whatsapp', async (req, res) => {
    try {
        if (req.body && (req.body.isFriday !== undefined || req.body.runAutomated === true)) {
            const isFriday = req.body.isFriday === true;
            logger.info(`Disparando envio manual da rotina automatizada: isFriday=${isFriday}`);
            const result = await logisticsReportService.runLogisticsReport(isFriday);
            return res.json({ success: true, message: 'Rotina de relatório logístico executada.', result });
        }

        const settings = configManager.getSettings();
        const logisticsNotifyNumbers = settings.logisticsNotifyNumbers || {};
        
        let targets = [];
        if (req.body && req.body.sendAll) {
            targets = ['20 + 6', '21', '22', '23', 'GERAL'];
        } else {
            const filial = (req.body && req.body.filial) || '20 + 6';
            targets = [filial];
        }
        
        const filialLabels = {
            '20 + 6': 'DF (Brasília)',
            '21': 'GO (Goiânia)',
            '22': 'TO (Palmas)',
            '23': 'MS (Campo Grande)',
            'GERAL': 'GERAL (Todas as Filiais)'
        };
        
        const results = [];
        
        for (const targetFilial of targets) {
            try {
                // Get configured numbers for this target
                let numbers = req.body && req.body.numbers;
                if (!numbers || numbers.length === 0) {
                    numbers = logisticsNotifyNumbers[targetFilial] || [];
                }
                
                if (numbers.length === 0) {
                    logger.warn(`Nenhum número configurado para enviar o relatório logístico da filial ${targetFilial}`);
                    results.push({ filial: targetFilial, success: false, error: 'Nenhum número configurado nas configurações.' });
                    continue;
                }
                
                logger.info(`Gerando e enviando relatório de logística para a filial ${targetFilial} para os números: ${numbers.join(', ')}`);
                
                // 1. Obter dados
                const data = await logisticsOracleService.getLogisticsData(targetFilial);
                
                // 1b. Obter transferências em trânsito
                let transfers = [];
                try {
                    if (targetFilial !== 'GERAL' && targetFilial !== 'ALL') {
                        transfers = await logisticsOracleService.getInterBranchTransfers(targetFilial);
                        logger.info(`Transferências em trânsito para manual ${targetFilial}: ${transfers.length} itens`);
                    }
                } catch (transErr) {
                    logger.warn(`Não foi possível buscar transferências para manual ${targetFilial}: ${transErr.message}`);
                }

                // 2. Gerar Excel
                const filePath = await logisticsExcelService.generateLogisticsExcel(data, transfers);
                
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

                const label = filialLabels[targetFilial] || targetFilial;
                let caption = `📊 *Relatório de Inteligência Logística — ${label}*\n\n` +
                    `📅 *Semana de Previsão:* ${weekLabel}\n` +
                    `📦 *Pedidos da Semana:* ${data.kpis.totalPedidosSemana}\n` +
                    `🔄 *Volume de Itens:* ${data.kpis.totalItensSemana.toLocaleString('pt-BR')} un. (${data.kpis.totalVolumeSemana.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³)\n` +
                    `🚨 *Itens Estoque Zero:* ${data.kpis.totalUrgentes}\n` +
                    `⚠️ *Itens Sem Endereço:* ${data.kpis.totalSemEndereco}\n\n` +
                    `📅 *Volume Previsto por Dia:*\n${dailySummaryText}\n\n`;

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
                    caption += `🚚 *Transferências em Trânsito (${Object.keys(grouped).length}):*\n${transLines.join('\n')}\n\n`;
                }

                caption += `_Planilha completa em anexo para o planejamento do recebimento e descarga._`;
                
                // 4. Enviar para cada número
                for (const num of numbers) {
                    try {
                        await whatsapp.sendFileToNumber(num, filePath, caption);
                        logger.info(`Relatório logístico da filial ${targetFilial} enviado com sucesso para ${num}`);
                    } catch (err) {
                        logger.error(`Erro ao enviar relatório logístico da filial ${targetFilial} para ${num}: ${err.message}`);
                    }
                }
                
                results.push({ filial: targetFilial, success: true });
            } catch (err) {
                logger.error(`Erro ao processar envio para a filial ${targetFilial}: ${err.message}`);
                results.push({ filial: targetFilial, success: false, error: err.message });
            }
        }
        
        res.json({
            success: true,
            message: `Processamento concluído. Tentativas de envio realizadas.`,
            results
        });
    } catch (err) {
        logger.error(`Erro na rota /api/logistics/send-whatsapp: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Dispara manualmente o envio do relatório de itens bloqueados/avariados do depósito
app.post('/api/logistics/blocked/send-whatsapp', async (req, res) => {
    try {
        const filial = (req.body && req.body.filial) || '20 + 6';
        const numbers = req.body && req.body.numbers;

        // Aguarda WhatsApp estar pronto (até 45s) para evitar race condition no boot
        if (!whatsapp.isClientReady()) {
            logger.info('[Deposito Bloqueados] WhatsApp ainda não pronto. Aguardando até 45s...');
            let waited = 0;
            while (!whatsapp.isClientReady() && waited < 45000) {
                await new Promise(r => setTimeout(r, 1000));
                waited += 1000;
            }
            if (!whatsapp.isClientReady()) {
                return res.status(503).json({ error: 'WhatsApp não está pronto. Tente novamente em alguns instantes.' });
            }
            logger.info(`[Deposito Bloqueados] WhatsApp pronto após ${waited / 1000}s. Prosseguindo...`);
        }
        
        logger.info(`Disparando manual do relatório de itens parados (bloqueados/avariados) para filial ${filial}`);
        const result = await warehouseBlockedReportService.runBlockedReport(filial, numbers);
        
        res.json({ success: true, message: 'Relatório de itens parados processado.', result });
    } catch (err) {
        logger.error(`Erro na rota /api/logistics/blocked/send-whatsapp: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// [GET] Listar todas as automações de mensagens
app.get('/api/automations', (req, res) => {
    try {
        const settings = configManager.getSettings();
        const monitorStatus = monitor.getStatus();
        const envSettings = configManager.getEnvSettings();

        const automations = [
            {
                id: 'monitor_realtime',
                name: 'Monitor de Entrada em Tempo Real',
                description: 'Verifica novas entradas de mercadorias no Oracle e envia alertas no WhatsApp para os vendedores responsáveis.',
                channel: 'WhatsApp',
                type: 'Polling',
                status: monitorStatus.active ? 'active' : 'inactive',
                cron: `A cada ${settings.pollIntervalMinutes} minuto(s)`,
                recipients: 'Vendedores vinculados a cada filial ativa',
                endpoint: '/api/control',
                action: monitorStatus.active ? 'stop' : 'start',
                triggerLabel: monitorStatus.active ? 'Parar Monitor' : 'Iniciar Monitor',
                configSection: 'config-geral'
            },
            {
                id: 'resumo_diario',
                name: 'Resumo Diário de Entrada (Estoque)',
                description: 'Gera um PDF com o resumo das mercadorias que deram entrada no dia e envia para a lista de administradores.',
                channel: 'WhatsApp',
                type: 'Agendado',
                status: 'active',
                cron: settings.pdfCronTime || '15 17 * * 1-5',
                recipients: `${settings.pdfNotifyNumbers.length} contato(s)`,
                endpoint: '/api/send-pdf-report',
                configSection: 'config-resumo'
            },
            {
                id: 'relatorio_vendas',
                name: 'Relatório Diário de Vendas',
                description: 'Consolida as vendas do dia anterior e envia o resumo e o PDF detalhado para os números cadastrados.',
                channel: 'WhatsApp',
                type: 'Agendado',
                status: 'active',
                cron: settings.salesPdfCronTime || '30 17 * * 1-5',
                recipients: `${settings.salesPdfNotifyNumbers.length} contato(s)`,
                endpoint: '/api/send-sales-report',
                configSection: 'config-vendas'
            },
            {
                id: 'ruptura_estoque',
                name: 'Relatório Diário de Rupturas (Giro Real)',
                description: 'Analisa rupturas de estoque para produtos com giro ativo e envia alertas aos administradores.',
                channel: 'WhatsApp',
                type: 'Agendado',
                status: 'active',
                cron: settings.ruptureCronTime || '30 18 * * 1-5',
                recipients: `${settings.ruptureNotifyNumbers.length} contato(s)`,
                endpoint: '/api/send-rupture-report',
                configSection: 'config-rupturas'
            },
            {
                id: 'compras_semanal',
                name: 'Relatório Semanal de Compras',
                description: 'Gera e envia a planilha Excel e o PDF de análise de cobertura de estoque e sugestões de compras automáticas.',
                channel: 'WhatsApp',
                type: 'Agendado',
                status: 'active',
                cron: settings.purchasingCronTime || '30 07 * * 5',
                recipients: `${settings.purchasingNotifyNumbers.length} contato(s)`,
                endpoint: '/api/send-purchasing-report',
                configSection: 'config-compras'
            },
            {
                id: 'supervisor_pdf',
                name: 'Relatórios Individuais de Supervisores',
                description: 'Analisa rupturas e coberturas e envia relatórios PDF customizados para cada supervisor cadastrado.',
                channel: 'WhatsApp',
                type: 'Agendado',
                status: 'active',
                cron: settings.supervisorCronTime || '35 17 * * 1-5',
                recipients: 'Supervisores cadastrados (dinâmico por filial)',
                endpoint: '/api/control',
                action: 'send-supervisor-reports',
                configSection: 'config-supervisores'
            },
            {
                id: 'personalized_products',
                name: 'Alerta de Produtos Personalizados',
                description: 'Monitora a chegada de produtos personalizados no estoque e avisa o vendedor ou RCA responsável via WhatsApp.',
                channel: 'WhatsApp',
                type: 'Agendado',
                status: 'active',
                cron: settings.personalizedProductsCronTime || '00 08 * * 1-5',
                recipients: 'Vendedor do cliente que encomendou (dinâmico)',
                endpoint: '/api/send-personalized-products-report',
                configSection: 'config-personalizados'
            },
            {
                id: 'novos_produtos',
                name: 'E-mail de Novos Produtos',
                description: 'Sincroniza produtos cadastrados recentemente na planilha Google Sheets e envia notificações por E-mail.',
                channel: 'E-mail',
                type: 'Agendado',
                status: 'active',
                cron: settings.newProductsCronTime || '30 07 * * 1-5',
                recipients: envSettings.emailTo || 'Configurado no .env',
                endpoint: '/api/send-new-products-report',
                configSection: 'config-novos-produtos'
            },
            {
                id: 'deposito_bloqueados',
                name: 'Relatório de Itens Bloqueados e Avariados do Depósito',
                description: 'Identifica itens parados no depósito (bloqueados e/ou avariados) com endereçamento WMS e sugere ações.',
                channel: 'WhatsApp',
                type: 'Agendado / Manual',
                status: 'active',
                cron: '30 08 * * 1', // toda segunda-feira às 08:30
                recipients: 'Gestores do Depósito / Configurado na Filial',
                endpoint: '/api/logistics/blocked/send-whatsapp',
                configSection: 'config-deposito-bloqueados'
            }
        ];

        res.json({ success: true, automations });
    } catch (err) {
        logger.error(`Erro ao listar automações: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Inicializa o servidor HTTP na porta designada
 */
function startServer() {
    return new Promise((resolve) => {
        app.listen(PORT, () => {
            logger.info(`\ud83c\udf10 Servidor HTTP rodando na porta ${PORT} -> http://localhost:${PORT}`);

            resolve();
        });
    });
}

module.exports = { startServer };
