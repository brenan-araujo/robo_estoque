require('dotenv').config();

const { startServer } = require('./server');
const monitor = require('./services/monitorController');
const pdfReportService = require('./services/pdfReportService');
const salesPdfService = require('./services/salesPdfService');
const newProductsEmailService = require('./services/newProductsEmailService');
const supervisorReportService = require('./services/supervisorReportService');
const ruptureReportService = require('./services/ruptureReportService');
const purchasingReportService = require('./services/purchasingReportService');
const personalizedProductsService = require('./services/personalizedProductsService');
const logger = require('./utils/logger');
const contactsSyncService = require('./services/contactsSyncService');
const logisticsReportService = require('./services/logisticsReportService');
const warehouseBlockedReportService = require('./services/warehouseBlockedReportService');

/**
 * Ponto de entrada principal
 */
async function main() {
    try {
        // 1. Inicializa o servidor HTTP Express (Painel Web)
        await startServer();

        // 2. Inicializa o agendador de resumo diário PDF de estoque (Cron)
        pdfReportService.initScheduler();

        // 3. Inicializa o agendador de relatório de vendas diário (Cron)
        salesPdfService.initScheduler();

        // 3.5. Inicializa o agendador de e-mail de novos produtos (Cron)
        newProductsEmailService.initScheduler();

        // 3.6. Inicializa o agendador de relatórios PDF dos supervisores (Cron)
        supervisorReportService.initScheduler();

        // 3.7. Inicializa o agendador de rupturas de estoque (Cron)
        ruptureReportService.initScheduler();

        // 3.8. Inicializa o agendador de relatório semanal de compras (Cron)
        purchasingReportService.initScheduler();

        // 3.9. Inicializa o agendador de produtos personalizados (Cron)
        personalizedProductsService.initScheduler();

        // 3.9.1. Inicializa o agendador do relatório de produtos pendentes de cadastro (ION) — sexta-feira
        require('./services/ionPendingReportService').initScheduler();

        // 3.10. Inicializa o agendador de sincronização diária de contatos (Cron)
        contactsSyncService.initScheduler();

        // 3.11. Inicializa o agendador de Inteligência Logística (Cron)
        logisticsReportService.initScheduler();

        // 3.11.1. Inicializa o agendador de Itens Bloqueados/Avariados do Depósito (Cron)
        warehouseBlockedReportService.initScheduler();

        // 3.12. Inicializa o agendador de campanhas customizadas (Cron)
        const campaignService = require('./services/campaignService');
        campaignService.initScheduler();

        // 3.13. Inicializa o agendador do relatório semanal de metas em PDF (Cron)
        const weeklyGoalsReportService = require('./services/weeklyGoalsReportService');
        weeklyGoalsReportService.initScheduler();

        // 4. Auto-inicia o monitoramento de estoque (Oracle + WhatsApp)
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
