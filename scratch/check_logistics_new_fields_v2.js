require('dotenv').config();
const database = require('../src/config/database');
const { getConnection, oracledb } = require('../src/config/database');
const { getLogisticsData } = require('../src/services/logisticsOracleService');

async function test() {
    await database.initialize();
    try {
        console.log('--- TEST NEW LOGISTICS KPI CALCULATIONS ---');
        const data = await getLogisticsData('20 + 6');
        
        console.log('KPIs:', data.kpis);
        
        console.log('\nWeek items count:', data.weekItems.length);
        const withVolume = data.weekItems.filter(item => item.CUBAGEM_CAIXA > 0);
        console.log('Week items with dimensions:', withVolume.length);
        
        // Calculate total volume
        let calculatedTotalVolume = 0;
        data.weekItems.forEach(item => {
            const vol = (item.CUBAGEM_CAIXA || 0) * (item.QTD_EMB_MASTER || 0);
            calculatedTotalVolume += vol;
            if (item.CUBAGEM_CAIXA > 0) {
                console.log(`Product: ${item.CODIGO_PRODUTO} - ${item.DESCRICAO_PRODUTO.substring(0, 20)} - Qty: ${item.SALDO_PEDIDO} - MasterQty: ${item.QTD_EMB_MASTER} - Cubagem: ${item.CUBAGEM_CAIXA} - Total Vol: ${vol.toFixed(4)} m³`);
            }
        });
        console.log(`\nTotal calculated volume for week: ${calculatedTotalVolume.toFixed(4)} m³`);

        // Check unaddressed items
        console.log('\nUnaddressed items count in week:', data.kpis.totalSemEndereco);
        console.log('Unaddressed samples:');
        data.alertas.semEndereco.slice(0, 10).forEach(item => {
            console.log(`Product: ${item.CODIGO_PRODUTO} - Rua: "${item.RUA}" - Apto: "${item.APARTAMENTO}"`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await database.close();
    }
}
test();
