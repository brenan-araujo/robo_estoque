require('dotenv').config();
const database = require('../src/config/database');
const ruptureService = require('../src/services/ruptureReportService');
const logger = require('../src/utils/logger');

async function main() {
    logger.info('🏁 Iniciando teste do Relatório de Ruptura de Estoque (Dry-run)...');
    try {
        // Inicializa o pool de conexões com o Oracle
        await database.initialize();

        // Executa o relatório em modo dry-run (gera o PDF localmente, não envia no whats, não atualiza histórico oficial)
        const result = await ruptureService.runRuptureReport(true);
        
        logger.info('--------------------------------------------------');
        logger.info(`✅ Teste concluído com sucesso!`);
        logger.info(`• Total de produtos em ruptura: ${result.productsCount}`);
        logger.info(`• Caminho do PDF gerado: ${result.pdfPath}`);
        logger.info('--------------------------------------------------');

    } catch (err) {
        logger.error(`❌ Erro no teste do relatório de rupturas: ${err.message}`);
        console.error(err);
    } finally {
        // Fecha o pool do banco
        await database.close();
        logger.info('⏹️ Pool Oracle encerrado.');
    }
}

main();
