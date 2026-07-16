require('dotenv').config();
const database = require('../src/config/database');
const logisticsOracleService = require('../src/services/logisticsOracleService');
const logisticsExcelService = require('../src/services/logisticsExcelService');

async function main() {
    console.log('🚀 Iniciando geração de planilha de produtos sem cubagem ou zerados...');
    await database.initialize();

    try {
        const products = await logisticsOracleService.getProductsWithoutCubage();
        console.log(`📊 Encontrados ${products.length} produtos sem cubagem.`);
        
        const filePath = await logisticsExcelService.generateProductsWithoutCubageExcel(products);
        console.log(`✅ Planilha gerada com sucesso em: ${filePath}`);
    } catch (err) {
        console.error('❌ Erro ao processar:', err.message);
    } finally {
        await database.close();
    }
}

main();
