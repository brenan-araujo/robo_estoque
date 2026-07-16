const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
    const workbook = new ExcelJS.Workbook();
    const filePath = path.join(__dirname, '..', 'data', 'produtos_sem_cubagem.xlsx');
    
    try {
        await workbook.xlsx.readFile(filePath);
        
        workbook.worksheets.forEach(ws => {
            console.log(`\n--- Sheet: ${ws.name} ---`);
            let count = 0;
            ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber > 3) {
                    const codProd = row.getCell(1).value;
                    const desc = row.getCell(2).value;
                    const fornecedor = row.getCell(5).value;
                    
                    if (String(desc).includes('BB') || String(fornecedor).toUpperCase().includes('SOFT WORKS')) {
                        console.log(`Row ${rowNumber}: Code=${codProd}, Desc=${desc}, Supplier=${fornecedor}`);
                        count++;
                    }
                }
            });
            console.log(`Found ${count} Soft Works/BB products in sheet ${ws.name}`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    }
}
main();
