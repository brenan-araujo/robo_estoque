require('dotenv').config();
const database = require('../src/config/database');
const { getLogisticsData } = require('../src/services/logisticsOracleService');

async function main() {
    await database.initialize();
    try {
        console.log('--- CHECK SATURDAY ARRIVALS ---');
        const data = await getLogisticsData('20 + 6');
        
        // Find items arriving on Saturday (getDay() === 6)
        const satItems = data.weekItems.filter(item => {
            return item.PREV_ENTREGA && item.PREV_ENTREGA.getDay() === 6;
        });

        console.log(`Found ${satItems.length} items for Saturday:`);
        satItems.forEach(item => {
            console.log(`Supplier: ${item.FORNECEDOR} (Cod: ${item.CODIGO_FORNECEDOR})`);
            console.log(`Product: ${item.CODIGO_PRODUTO} - ${item.DESCRICAO_PRODUTO}`);
            console.log(`Qty: ${item.SALDO_PEDIDO} - MasterQty (Caixas): ${item.QTD_EMB_MASTER} - Cubagem: ${item.CUBAGEM_CAIXA}`);
            console.log(`Address: Rua ${item.RUA} / Predio ${item.PREDIO} / Apto ${item.APARTAMENTO}`);
            console.log(`Prev Entrega: ${item.PREV_ENTREGA}`);
            console.log('------------------------------------');
        });

    } catch (err) {
        console.error(err);
    } finally {
        await database.close();
    }
}
main();
