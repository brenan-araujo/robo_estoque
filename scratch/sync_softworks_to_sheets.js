require('dotenv').config();
const fs = require('fs');
const path = require('path');
const googleSheetsService = require('../src/services/googleSheetsService');

async function main() {
    const filePath = path.join(__dirname, 'unique_softworks_to_sync.json');
    if (!fs.existsSync(filePath)) {
        console.error('Deduplicated Soft Works JSON not found. Please run scratch/deduplicate_softworks.js first.');
        return;
    }
    
    const products = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Loaded ${products.length} unique Soft Works products to sync.`);
    
    // Map properties to match what database returns (CODPROD, DESCRICAO, NOMEECOMMERCE, DIRFOTOPROD, CODFORNEC, DTCADASTRO, FORNECEDOR)
    const formattedProducts = products.map(p => ({
        CODPROD: p.CODPROD,
        DESCRICAO: p.DESCRICAO,
        NOMEECOMMERCE: p.NOMEECOMMERCE || '',
        DIRFOTOPROD: p.DIRFOTOPROD || '',
        CODFORNEC: p.CODFORNEC,
        DTCADASTRO: p.DTCADASTRO || new Date().toLocaleDateString('pt-BR'),
        FORNECEDOR: p.FORNECEDOR
    }));
    
    try {
        console.log('Sending products to Google Sheets Web App...');
        const result = await googleSheetsService.sendProductsToSheets(formattedProducts);
        console.log('Result:', result);
    } catch (err) {
        console.error('Error sending products to Sheets:', err);
    }
}

main();
