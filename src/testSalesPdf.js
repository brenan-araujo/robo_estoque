require('dotenv').config();

const salesPdfService = require('./services/salesPdfService');
const salesOracleService = require('./services/salesOracleService');
const logger = require('./utils/logger');

// Inicializa o pool Oracle
const db = require('./config/database');

async function testPdf() {
    try {
        console.log('🔄 Inicializando pool Oracle...');
        await db.initialize();

        const dateArg = process.argv[2];
        let targetDate;
        if (dateArg) {
            const parts = dateArg.split(/[-/]/);
            if (parts.length === 3) {
                targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            } else {
                targetDate = new Date(dateArg);
            }
            if (isNaN(targetDate.getTime())) {
                console.error(`❌ Data inválida: ${dateArg}. Use o formato YYYY-MM-DD.`);
                process.exit(1);
            }
        } else {
            // Por padrão, usa ontem (2026-05-28) para testar com dados reais consolidados
            targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - 1);
        }

        console.log(`📊 Gerando PDF de vendas para data de referência: ${targetDate.toLocaleDateString('pt-BR')}...`);
        const data = await salesOracleService.getFullSalesReport(targetDate);
        const pdfPath = await salesPdfService.generateSalesPdf(data);
        console.log(`✅ PDF gerado com sucesso em: ${pdfPath}`);
        console.log('Abra o arquivo para verificar o visual.');

    } catch (err) {
        console.error(`❌ Erro: ${err.message}`);
        console.error(err.stack);
    } finally {
        await db.close();
        process.exit(0);
    }
}

testPdf();
