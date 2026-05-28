const database = require('../config/database');
const oracleService = require('./oracleService');
const whatsapp = require('./whatsappService');
const { getLastUnlockDate, saveLastUnlockDate } = require('../utils/stateManager');
const configManager = require('../utils/configManager');
const logger = require('../utils/logger');

let state = 'STOPPED'; // 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'
let dbStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
let whatsappStatus = 'disconnected'; // 'disconnected' | 'authenticating' | 'authenticated' | 'ready' | 'error'
let qrCode = null;
let lastScanTime = null;
let lastScanError = null;
let timer = null;
let currentPollInterval = null;
let startTime = null;

let autoRestartAttempts = 0;
let isRestarting = false;

/**
 * Retorna o status atual do monitoramento
 */
function getStatus() {
    return {
        state,
        dbStatus,
        whatsappStatus,
        hasQrCode: !!qrCode,
        qrCode, // QR code string
        lastScanTime,
        lastScanError,
        uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
        pollInterval: currentPollInterval || configManager.getPollInterval(),
        autoRestartAttempts
    };
}

/**
 * Executa uma verificação manual
 */
async function runScan() {
    logger.info('🔍 Iniciando verificação manual de novas entradas...');
    lastScanTime = new Date().toISOString();
    try {
        const { checkNewProducts } = require('../jobs/checkProducts');
        await checkNewProducts();
        lastScanError = null;
        return { success: true };
    } catch (err) {
        logger.error(`Erro na verificação: ${err.message}`);
        lastScanError = err.message;
        return { success: false, error: err.message };
    }
}

/**
 * Configura o intervalo de polling
 */
function startInterval() {
    if (timer) clearInterval(timer);
    const intervalMinutes = configManager.getPollInterval();
    currentPollInterval = intervalMinutes;
    logger.info(`⏰ Monitoramento automático agendado a cada ${intervalMinutes} minuto(s)`);
    timer = setInterval(async () => {
        if (state === 'RUNNING') {
            logger.info('⏰ Executando verificação programada...');
            await runScan();
        }
    }, intervalMinutes * 60 * 1000);
}

/**
 * Atualiza o intervalo caso tenha mudado nas configurações
 */
function refreshInterval() {
    if (state === 'RUNNING') {
        const intervalMinutes = configManager.getPollInterval();
        if (intervalMinutes !== currentPollInterval) {
            logger.info(`🔄 Ajustando intervalo de consulta de ${currentPollInterval} para ${intervalMinutes} minutos`);
            startInterval();
        }
    }
}

/**
 * Inicia o monitoramento
 */
async function start() {
    if (state === 'STARTING' || state === 'RUNNING' || state === 'STOPPING') {
        logger.warn(`Monitor em transição ou ativo. Estado atual: ${state}`);
        return getStatus();
    }

    state = 'STARTING';
    startTime = Date.now();
    qrCode = null;
    lastScanError = null;

    try {
        // 1. Conecta ao Oracle
        logger.info('Iniciando conexão com Oracle...');
        dbStatus = 'connecting';
        await database.initialize();
        
        const oracleOk = await oracleService.testConnection();
        if (!oracleOk) {
            dbStatus = 'error';
            throw new Error('Falha na conexão de teste com o Oracle');
        }
        dbStatus = 'connected';
        logger.info('Oracle conectado com sucesso no monitor');

        // 2. Inicializa o estado (lastUnlockDate) se necessário
        const currentState = getLastUnlockDate();
        if (currentState === null) {
            logger.info('Primeira execução detectada. Marcando ponto de desbloqueio atual...');
            const conn = await database.getConnection();
            try {
                const result = await conn.execute(
                    'SELECT MAX(DTDESBLOQUEIO) AS MAXDATE FROM PCLOGDESBLOQUEIO WHERE DTDESBLOQUEIO IS NOT NULL',
                    [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
                );
                // Se não houver nenhum registro, usa a data atual
                const maxDate = result.rows[0]?.MAXDATE || new Date();
                const isoDateStr = new Date(maxDate).toISOString();
                saveLastUnlockDate(isoDateStr);
                logger.info(`Estado inicial definido: lastUnlockDate = ${isoDateStr}`);
            } finally {
                await conn.close();
            }
        }

        // 3. Conecta ao WhatsApp
        logger.info('Iniciando cliente do WhatsApp...');
        whatsappStatus = 'authenticating';
        
        // WhatsApp initialize retorna Promise que resolve quando está pronto
        await whatsapp.initialize({
            onQr: (qr) => {
                qrCode = qr;
                whatsappStatus = 'authenticating';
                logger.info('QR Code recebido no monitor');
            },
            onReady: () => {
                whatsappStatus = 'ready';
                qrCode = null;
                logger.info('WhatsApp pronto no monitor');
                autoRestartAttempts = 0; // Reset details once connection is successful
                if (state === 'STARTING') {
                    state = 'RUNNING';
                    startInterval();
                    // Executa primeira verificação
                    runScan();
                }
            },
            onAuthenticated: () => {
                whatsappStatus = 'authenticated';
                qrCode = null;
                logger.info('WhatsApp autenticado no monitor');
            },
            onDisconnected: (reason) => {
                whatsappStatus = 'disconnected';
                logger.warn(`WhatsApp desconectado: ${reason}`);
                // Se foi desconectado e ainda está rodando, tenta reiniciar
                if (state === 'RUNNING') {
                    if (autoRestartAttempts < 3) {
                        autoRestartAttempts++;
                        logger.warn(`⚠️ Queda de conexão detectada. Iniciando auto-reinício (${autoRestartAttempts}/3) em 5 segundos...`);
                        setTimeout(async () => {
                            try {
                                if (state === 'RUNNING' || state === 'ERROR') {
                                    logger.info('Iniciando auto-reinício automático do monitor após erro fatal...');
                                    await restart();
                                }
                            } catch (err) {
                                logger.error(`Falha no auto-reinício automático: ${err.message}`);
                            }
                        }, 5000);
                    } else {
                        state = 'ERROR';
                        logger.error('❌ Limite de tentativas de auto-reinício (3) atingido. O monitor foi parado e marcado com ERRO.');
                    }
                }
            },
            onAuthFailure: (msg) => {
                whatsappStatus = 'disconnected';
                logger.error(`Falha de autenticação WhatsApp: ${msg}`);
                state = 'ERROR';
            }
        });

    } catch (err) {
        logger.error(`Erro ao iniciar monitor: ${err.message}`);
        state = 'ERROR';
        if (timer) clearInterval(timer);
        timer = null;
        await whatsapp.destroy().catch(() => {});
        await database.close().catch(() => {});
        dbStatus = 'disconnected';
        whatsappStatus = 'disconnected';
        qrCode = null;
        throw err;
    }

    return getStatus();
}

/**
 * Desliga o monitoramento
 */
async function stop() {
    if (state === 'STOPPED' || state === 'STOPPING') {
        logger.warn(`Monitor já parou ou está parando. Estado atual: ${state}`);
        return getStatus();
    }

    logger.info('Parando monitoramento...');
    state = 'STOPPING';

    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    try {
        await whatsapp.destroy();
    } catch (err) {
        logger.error(`Erro ao destruir WhatsApp: ${err.message}`);
    }
    whatsappStatus = 'disconnected';
    qrCode = null;

    try {
        await database.close();
    } catch (err) {
        logger.error(`Erro ao fechar pool de banco: ${err.message}`);
    }
    dbStatus = 'disconnected';

    state = 'STOPPED';
    startTime = null;
    logger.info('Monitoramento desligado com sucesso');
    
    return getStatus();
}

/**
 * Reinicia o monitoramento
 */
async function restart() {
    if (isRestarting) {
        logger.warn('Reinício já em andamento, ignorando chamada duplicada.');
        return getStatus();
    }
    isRestarting = true;
    try {
        logger.info('Solicitado reinício do monitoramento...');
        await stop();
        // Espera 2s para que portas/arquivos do Puppeteer sejam liberados
        await new Promise(resolve => setTimeout(resolve, 2000));
        await start();
    } finally {
        isRestarting = false;
    }
    return getStatus();
}

/**
 * Desconecta o WhatsApp e limpa a sessão para permitir vincular outra conta
 */
async function logoutWhatsApp() {
    logger.info('Iniciando processo de desconexão da conta WhatsApp...');
    
    // Para o monitoramento temporariamente para liberar tudo
    const wasRunning = (state === 'RUNNING');
    await stop();
    
    // Executa o logout e limpeza de pasta
    await whatsapp.logout();
    
    // Reseta estado local do monitor
    whatsappStatus = 'disconnected';
    qrCode = null;
    autoRestartAttempts = 0;
    
    // Reinicia o monitor automaticamente para gerar o novo QR code imediatamente
    logger.info('Reiniciando o monitor para exibir o novo QR Code...');
    // Inicia em background para não travar a requisição HTTP
    setTimeout(() => {
        start().catch(err => {
            logger.error(`Falha ao reiniciar monitor em segundo plano pós-logout: ${err.message}`);
        });
    }, 2000);
    
    return getStatus();
}

module.exports = {
    getStatus,
    runScan,
    start,
    stop,
    restart,
    refreshInterval,
    logoutWhatsApp
};
