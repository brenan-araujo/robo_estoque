require('dotenv').config();

const { startServer } = require('./server');
const monitor = require('./services/monitorController');
const logger = require('./utils/logger');

/**
 * Ponto de entrada principal
 */
async function main() {
    try {
        // 1. Inicializa o servidor HTTP Express (Painel Web)
        await startServer();

        // 2. Auto-inicia o monitoramento de estoque (Oracle + WhatsApp)
        // Isso preserva o comportamento original do sistema ao ser executado
        monitor.start().catch((err) => {
            logger.error(`Falha no auto-início do monitoramento: ${err.message}`);
        });

    } catch (err) {
        logger.error(`Erro fatal ao inicializar aplicação: ${err.message}`);
        process.exit(1);
    }
}

// Encerramento limpo do processo
const shutdown = async (signal) => {
    logger.info(`Sinal ${signal} recebido. Desativando monitoramento e parando processos...`);
    try {
        await monitor.stop();
        logger.info('Aplicação encerrada graciosamente.');
        process.exit(0);
    } catch (err) {
        logger.error(`Erro durante o desligamento: ${err.message}`);
        process.exit(1);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
    logger.error(`Exceção não tratada: ${err.message}`);
    logger.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
    logger.error(`Promise rejeitada não capturada: ${reason}`);
});

main();
