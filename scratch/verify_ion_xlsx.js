const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(__dirname, '..', 'data', 'produtos_pendentes_ion.xlsx'));
    const ws = wb.getWorksheet('Produtos Pendentes');

    console.log('Dimensões:', ws.rowCount, 'linhas x', ws.columnCount, 'colunas');
    console.log('\nCabeçalho (linha 2):');
    console.log('  ' + ws.getRow(2).values.slice(1).join(' | '));

    // Lista merges (ExcelJS guarda em ws._merges)
    const merges = ws.model.merges || Object.keys(ws._merges || {});
    console.log(`\nTotal de merges: ${merges.length}`);
    console.log('Primeiros 8 merges:', merges.slice(0, 8).join(', '));

    console.log('\nPrimeiras 8 linhas de dados (col A-F):');
    for (let r = 3; r <= 10; r++) {
        const row = ws.getRow(r);
        const vals = [1,2,3,4,5,6].map(c => {
            const v = row.getCell(c).value;
            return v === null || v === undefined || v === '' ? '·' : String(v).slice(0, 24);
        });
        console.log(`  L${r}: ` + vals.join(' | '));
    }
}
main().catch(e => console.error(e.message));
