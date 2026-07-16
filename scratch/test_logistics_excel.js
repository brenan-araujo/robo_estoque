const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

console.log('🧪 Iniciando validação do arquivo Excel gerado...');

const filePath = path.join(__dirname, '..', 'data', 'inteligencia_logistica_20_6.xlsx');

if (!fs.existsSync(filePath)) {
    console.error(`❌ Planilha não encontrada em ${filePath}. Por favor, rode scratch/test_logistics_report.js primeiro.`);
    process.exit(1);
}

async function validateExcel() {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        
        console.log(`Planilha lida com sucesso de: ${filePath}`);
        
        // 1. Validar Abas
        const sheets = workbook.worksheets.map(w => w.name);
        console.log('Abas encontradas:', sheets);
        
        if (!sheets.includes('Resumo Executivo')) {
            throw new Error('Aba "Resumo Executivo" não encontrada!');
        }

        const wsDashboard = workbook.getWorksheet('Resumo Executivo');

        // 2. Validar cabeçalhos na linha 8 (onde ficam os títulos do Cronograma)
        const colD = wsDashboard.getCell('D8').value;
        const colE = wsDashboard.getCell('E8').value;
        const colF = wsDashboard.getCell('F8').value;

        console.log('Linha 8 (Cronograma Headers):');
        console.log(`- Coluna D: "${colD}"`);
        console.log(`- Coluna E: "${colE}"`);
        console.log(`- Coluna F: "${colF}"`);

        if (colD !== 'QTD ITENS') {
            throw new Error(`Coluna D esperada 'QTD ITENS', obtido: '${colD}'`);
        }
        if (colE !== 'QTD CAIXAS') {
            throw new Error(`Coluna E esperada 'QTD CAIXAS', obtido: '${colE}'`);
        }
        if (colF !== 'VOLUME DE ITENS M3') {
            throw new Error(`Coluna F esperada 'VOLUME DE ITENS M3', obtido: '${colF}'`);
        }

        // 3. Validar se o Total Geral está preenchido corretamente na última linha de dados
        // Vamos varrer a coluna B a procura de "Total Geral"
        let totalGeralRow = -1;
        for (let r = 9; r <= wsDashboard.rowCount; r++) {
            const val = wsDashboard.getCell(`B${r}`).value;
            if (val === 'Total Geral') {
                totalGeralRow = r;
                break;
            }
        }

        if (totalGeralRow === -1) {
            throw new Error('Linha "Total Geral" não encontrada na coluna B!');
        }

        console.log(`Linha do "Total Geral" encontrada na linha: ${totalGeralRow}`);
        
        const totalItens = wsDashboard.getCell(`D${totalGeralRow}`).value;
        const totalCaixas = wsDashboard.getCell(`E${totalGeralRow}`).value;
        const totalVolume = wsDashboard.getCell(`F${totalGeralRow}`).value;

        console.log(`Valores do Total Geral:`);
        console.log(`- Itens: ${totalItens}`);
        console.log(`- Caixas: ${totalCaixas}`);
        console.log(`- Volume: ${totalVolume}`);

        if (typeof totalItens !== 'number' || totalItens <= 0) {
            throw new Error(`Total de itens inválido: ${totalItens}`);
        }
        if (typeof totalCaixas !== 'number' || totalCaixas <= 0) {
            throw new Error(`Total de caixas inválido: ${totalCaixas}`);
        }
        if (typeof totalVolume !== 'number' || totalVolume <= 0) {
            throw new Error(`Total de volume inválido: ${totalVolume}`);
        }

        console.log('✅ VALIDAÇÃO DO EXCEL APROVADA COM SUCESSO!');
    } catch (err) {
        console.error('❌ Erro na validação do Excel:', err.message);
        process.exit(1);
    }
}

validateExcel();
