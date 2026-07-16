require('dotenv').config();
const database = require('../src/config/database');
const oracleService = require('../src/services/oracleService');
const salesOracleService = require('../src/services/salesOracleService');

async function run() {
    try {
        await database.initialize();
        
        console.log('--- Starting Benchmark ---');
        
        console.time('Funnel Products Query');
        const funnel = await oracleService.getFunnelProducts();
        console.timeEnd('Funnel Products Query');
        console.log(`Funnel returned ${funnel.length} rows.`);

        console.log('\n--------------------------\n');

        console.time('Sales Data Query');
        const sales = await salesOracleService.getFullSalesReport(new Date());
        console.timeEnd('Sales Data Query');
        console.log('Sales query completed.');

    } catch (err) {
        console.error('Benchmark Error:', err);
    } finally {
        await database.close();
    }
}

run();
