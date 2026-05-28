const express = require('express');
const path = require('path');
const fs = require('fs');
const configManager = require('./utils/configManager');
const sentTracker = require('./utils/sentTracker');
const monitor = require('./services/monitorController');
const logger = require('./utils/logger');
const oracleService = require('./services/oracleService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir arquivos estáticos do frontend (pasta src/public)
app.use(express.static(path.join(__dirname, 'public')));

// Helper para obter os últimos logs do arquivo app.log
function getRecentLogs(maxLines = 100) {
    const logFile = path.join(__dirname, '..', 'logs', 'app.log');
    if (!fs.existsSync(logFile)) {
        return ['Arquivo de log ainda não criado. O monitor precisa ser iniciado primeiro.'];
    }
    try {
        const data = fs.readFileSync(logFile, 'utf8');
        const lines = data.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines.slice(-maxLines);
    } catch (err) {
        return [`Erro ao ler arquivo de log: ${err.message}`];
    }
}

// [GET] Status geral do monitoramento
app.get('/api/status', (req, res) => {
    try {
        res.json(monitor.getStatus());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Controle de ações do monitor (start, stop, restart, scan, logout-whatsapp)
app.post('/api/control', async (req, res) => {
    const { action } = req.body;
    try {
        if (action === 'start') {
            // Executa inicialização assíncrona em background para não travar a resposta HTTP
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
            return res.json({ message: 'WhatsApp desconectado. Sessão apagada.', status });
        } else {
            return res.status(400).json({ error: 'Ação inválida. Use start, stop, restart, scan ou logout-whatsapp.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [GET] Buscar configurações vigentes
app.get('/api/settings', (req, res) => {
    try {
        res.json(configManager.getSettings());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [POST] Atualizar configurações vigentes
app.post('/api/settings', (req, res) => {
    try {
        const success = configManager.saveSettings(req.body);
        if (success) {
            monitor.refreshInterval();
            return res.json({ success: true, settings: configManager.getSettings() });
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

// [GET] Histórico das mensagens enviadas
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
        const logs = getRecentLogs(100);
        res.json({ logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota para servir o painel frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Inicializa o servidor HTTP na porta designada
 */
function startServer() {
    return new Promise((resolve) => {
        app.listen(PORT, () => {
            logger.info(`🌐 Servidor HTTP rodando na porta ${PORT} -> http://localhost:${PORT}`);
            resolve();
        });
    });
}

module.exports = { startServer };
