const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const excelPath = path.join(__dirname, '..', 'data', 'produtos_sem_cubagem.xlsx');
const matchedProducts = JSON.parse(fs.readFileSync(path.join(__dirname, 'matched_products.json'), 'utf8'));

// Rules for formatting
const thinBorder = {
    top: { style: 'thin', color: { argb: 'CBD5E1' } },
    left: { style: 'thin', color: { argb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
    right: { style: 'thin', color: { argb: 'CBD5E1' } }
};

const fontRegular = { name: 'Calibri', size: 10, color: { argb: '334155' } };

async function main() {
    const workbook = new ExcelJS.Workbook();
    
    if (!fs.existsSync(excelPath)) {
        console.error(`Spreadsheet not found at: ${excelPath}`);
        return;
    }
    
    try {
        await workbook.xlsx.readFile(excelPath);
        console.log('Successfully loaded spreadsheet.');
        
        const wsWithStock = workbook.getWorksheet('Com Estoque Filial 20');
        const wsWithoutStock = workbook.getWorksheet('Sem Estoque Filial 20');
        
        if (!wsWithStock || !wsWithoutStock) {
            console.error('Worksheets not found.');
            return;
        }
        
        // Build sets of existing product codes to avoid duplicates
        const existingCodes = new Set();
        
        const scanSheet = (ws) => {
            ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber > 3) {
                    const cod = Number(row.getCell(1).value);
                    if (cod) {
                        existingCodes.add(cod);
                    }
                }
            });
        };
        
        scanSheet(wsWithStock);
        scanSheet(wsWithoutStock);
        
        console.log(`Scanned sheets. Found ${existingCodes.size} unique existing product codes.`);
        
        let addedWithStock = 0;
        let addedWithoutStock = 0;
        
        matchedProducts.forEach(p => {
            if (existingCodes.has(Number(p.CODPROD))) {
                // Already in spreadsheet, skip
                return;
            }
            
            const targetSheet = (Number(p.ESTOQUE_20) || 0) > 0 ? wsWithStock : wsWithoutStock;
            
            // Add row
            const newRow = targetSheet.addRow([
                p.CODPROD,
                p.DESCRICAO,
                p.QTUNITCX,
                p.CODFORNEC,
                p.FORNECEDOR,
                p.ESTOQUE_20,
                p.ESTOQUE_DISP_20,
                p.ALTURAM3 || 0,
                p.LARGURAM3 || 0,
                p.COMPRIMENTOM3 || 0
            ]);
            
            // Style row cells
            newRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.font = fontRegular;
                cell.border = thinBorder;
                
                // Alignments
                if (colNumber === 1 || colNumber === 3 || colNumber === 4) {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if (colNumber === 6 || colNumber === 7 || colNumber >= 8) {
                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                }
                
                // Formatting
                if (colNumber === 1 || colNumber === 3 || colNumber === 4 || colNumber === 6 || colNumber === 7) {
                    cell.numFmt = '#,##0';
                } else if (colNumber >= 8) {
                    cell.numFmt = '#,##0.00';
                }
            });
            
            newRow.height = 20;
            
            if ((Number(p.ESTOQUE_20) || 0) > 0) {
                addedWithStock++;
            } else {
                addedWithoutStock++;
            }
            
            existingCodes.add(Number(p.CODPROD));
        });
        
        console.log(`Added ${addedWithStock} products to 'Com Estoque Filial 20'.`);
        console.log(`Added ${addedWithoutStock} products to 'Sem Estoque Filial 20'.`);
        
        // Recalculate totals in cell A2/merged cells
        const updateSubtitle = (ws, titlePrefix) => {
            // Count rows manually starting from row 4
            let count = 0;
            ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber > 3) {
                    count++;
                }
            });
            
            const subtitleCell = ws.getCell('A2');
            subtitleCell.value = `Total de itens: ${count} produtos | Atualizado em: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`;
            console.log(`Updated ${ws.name} subtitle with total: ${count} products.`);
            
            // Update title A1 just to be safe
            const titleCell = ws.getCell('A1');
            titleCell.value = titlePrefix;
        };
        
        updateSubtitle(wsWithStock, 'PRODUTOS SEM CUBAGEM COM ESTOQUE NA FILIAL 20');
        updateSubtitle(wsWithoutStock, 'PRODUTOS SEM CUBAGEM SEM ESTOQUE NA FILIAL 20');
        
        // Save Excel file
        await workbook.xlsx.writeFile(excelPath);
        console.log(`Excel file updated successfully at: ${excelPath}`);
        
    } catch (err) {
        console.error('Error modifying spreadsheet:', err);
    }
}

main();
