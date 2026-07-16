const ExcelJS = require('exceljs');
const path = require('path');

async function checkExcelSheets() {
    const filePath = path.join(__dirname, '..', 'data', 'inteligencia_logistica_20_6.xlsx');
    console.log('Lendo planilha:', filePath);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    console.log('\nAbas encontradas na planilha:');
    workbook.worksheets.forEach((sheet, index) => {
        console.log(`  ${index + 1}. [${sheet.name}] - Linhas: ${sheet.rowCount}`);
    });
}

checkExcelSheets().catch(err => console.error(err));
