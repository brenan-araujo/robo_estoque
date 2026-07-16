require('dotenv').config();
const database = require('../src/config/database');
const { getLogisticsData } = require('../src/services/logisticsOracleService');
const { generateLogisticsExcel } = require('../src/services/logisticsExcelService');

async function main() {
    console.log('🚀 Iniciando teste do Relatório de Inteligência Logística...');
    await database.initialize();

    try {
        const filial = '20 + 6';
        console.log(`\n1. Consultando dados para filial ${filial}...`);
        const data = await getLogisticsData(filial);

        console.log('\n--- RESULTADOS CONSULTA ORACLE ---');
        console.log('KPIs:', data.kpis);
        console.log('Cronograma Diário:', data.cronograma);
        console.log('Top Fornecedores:', data.topFornecedores);
        console.log('Itens na Semana:', data.weekItems.length);
        console.log('Itens Carteira Completa:', data.allItems.length);

        console.log('\nAmostra de Itens sem Endereço (máx 3):');
        console.table(data.alertas.semEndereco.slice(0, 3));

        console.log('\nAmostra de Itens com Estoque Zero (máx 3):');
        console.table(data.alertas.urgenciaRecebimento.slice(0, 3));

        console.log('\n2. Gerando arquivo Excel...');
        const filePath = await generateLogisticsExcel(data);
        console.log(`\n✅ Excel gerado com sucesso em: ${filePath}`);

    } catch (err) {
        console.error('\n❌ Erro durante o teste:', err);
    } finally {
        await database.close();
        console.log('\nPool Oracle fechado. Fim do teste.');
    }
}

main();
