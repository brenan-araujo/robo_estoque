const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
    const workbook = new ExcelJS.Workbook();
    const filePath = path.join(__dirname, '..', 'data', 'produtos_sem_cubagem.xlsx');
    
    try {
        await workbook.xlsx.readFile(filePath);
        console.log('Worksheet names:', workbook.worksheets.map(w => w.name));
        
        workbook.worksheets.forEach(ws => {
            console.log(`\n--- Sheet: ${ws.name} ---`);
            // Print first 5 rows
            ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber <= 5) {
                    console.log(`Row ${rowNumber}:`, row.values);
                }
            });
            console.log(`Total rows: ${ws.rowCount}`);
        });
    } catch (err) {
        console.error('Error reading excel:', err.message);
    }
}
main();
