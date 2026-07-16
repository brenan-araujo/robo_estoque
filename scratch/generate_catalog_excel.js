const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function main() {
    const rawPath = path.join(__dirname, 'softworks_catalog_raw.json');
    if (!fs.existsSync(rawPath)) {
        console.error('Raw catalog data not found. Run merge_all.js first.');
        return;
    }
    
    const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    const workbook = new ExcelJS.Workbook();
    
    // Theme Colors
    const headerColor = 'FF1E3A8A'; // Dark Navy Blue
    const stripeColor = 'FFF1F5F9'; // Light Gray-Blue Slate
    const whiteFont = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    const defaultFont = { name: 'Calibri', size: 10 };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
    const stripeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } };
    
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
    
    // --- SHEET 1: RESUMO POR MODELO ---
    console.log('Generating Sheet 1: Resumo por Modelo...');
    const ws1 = workbook.addWorksheet('Resumo por Modelo', { views: [{ showGridLines: true }] });
    
    ws1.columns = [
        { header: 'Modelo', key: 'model', width: 12 },
        { header: 'Nome no Sistema (Sem Abreviações)', key: 'name', width: 35 },
        { header: 'CA (MTE)', key: 'ca', width: 15 },
        { header: 'Grade de Tamanhos', key: 'grade', width: 25 },
        { header: 'Cores Disponíveis', key: 'colors', width: 35 },
        { header: 'Total SKUs', key: 'skus_count', width: 12 },
        { header: 'Estoque Total (F.20)', key: 'total_stock', width: 20 },
        { header: 'Descrição / Especificações Técnicas', key: 'specs', width: 50 },
        { header: 'Tecnologia do Solado (SRC)', key: 'solado', width: 40 },
        { header: 'Diferenciais', key: 'differentials', width: 40 },
        { header: 'Ficha Técnica PDF', key: 'ficha_pdf', width: 20 },
        { header: 'CA PDF', key: 'ca_pdf', width: 20 },
        { header: 'Certificado CE PDF', key: 'ce_pdf', width: 20 },
        { header: 'Certificado IBETEC PDF', key: 'ibetec_pdf', width: 20 }
    ];
    
    // Add models summary
    data.models_summary.forEach((m, idx) => {
        const row = ws1.addRow({
            model: m.model,
            name: m.name,
            ca: m.ca,
            grade: m.grade,
            colors: m.colors,
            skus_count: m.skus_count,
            total_stock: m.total_stock,
            specs: m.specs,
            solado: m.solado,
            differentials: m.differentials,
            ficha_pdf: m.ficha_pdf ? 'Ver Ficha' : '',
            ca_pdf: m.ca_pdf ? 'Ver CA' : '',
            ce_pdf: m.ce_pdf ? 'Ver CE' : '',
            ibetec_pdf: m.ibetec_pdf ? 'Ver IBETEC' : ''
        });
        
        // Add Hyperlinks for PDFs
        if (m.ficha_pdf) row.getCell('ficha_pdf').value = { text: 'Ficha Técnica', hyperlink: m.ficha_pdf };
        if (m.ca_pdf) row.getCell('ca_pdf').value = { text: 'PDF do CA', hyperlink: m.ca_pdf };
        if (m.ce_pdf) row.getCell('ce_pdf').value = { text: 'Satra CE', hyperlink: m.ce_pdf };
        if (m.ibetec_pdf) row.getCell('ibetec_pdf').value = { text: 'Selo Conforto', hyperlink: m.ibetec_pdf };
        
        // Formatting row cells
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.font = defaultFont;
            cell.border = thinBorder;
            cell.alignment = { vertical: 'middle', wrapText: true };
            
            // Align numbers
            if (colNumber === 6 || colNumber === 7) {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
            
            // Blue text for links
            if (cell.value && cell.value.hyperlink) {
                cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF2563EB' }, underline: 'single' };
            }
        });
        
        // Zebra striping
        if (idx % 2 === 1) {
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = stripeFill;
            });
        }
    });
    
    // Style Header Row for Sheet 1
    const row1 = ws1.getRow(1);
    row1.height = 30;
    row1.eachCell((cell) => {
        cell.font = whiteFont;
        cell.fill = headerFill;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    
    // --- SHEET 2: DETALHAMENTO POR SKU ---
    console.log('Generating Sheet 2: Detalhamento por SKU...');
    const ws2 = workbook.addWorksheet('Detalhamento por SKU', { views: [{ showGridLines: true }] });
    
    ws2.columns = [
        { header: 'Cód. Winthor', key: 'codprod', width: 15 },
        { header: 'Descrição Winthor', key: 'descricao_winthor', width: 35 },
        { header: 'Descrição Sem Abreviações', key: 'nome_sistema_limpo', width: 35 },
        { header: 'EAN (Cód. Auxiliar)', key: 'barcode', width: 18 },
        { header: 'Modelo', key: 'model', width: 10 },
        { header: 'Cor (Winthor)', key: 'color_db', width: 15 },
        { header: 'Tamanho', key: 'size', width: 10 },
        { header: 'Unidade', key: 'unidade', width: 10 },
        { header: 'NCM', key: 'ncm', width: 15 },
        { header: 'Estoque F.20', key: 'estoque_20', width: 15 },
        { header: 'Estoque Disp. F.20', key: 'estoque_disp_20', width: 18 },
        { header: 'Peso Líquido (kg)', key: 'peso_liquido', width: 18 },
        { header: 'Peso Bruto (kg)', key: 'peso_bruto', width: 18 },
        { header: 'Altura (cm)', key: 'altura_m3', width: 12 },
        { header: 'Largura (cm)', key: 'largura_m3', width: 12 },
        { header: 'Comprimento (cm)', key: 'comprimento_m3', width: 15 },
        { header: 'Fotos Mapeadas (P:\\fotosprodutos\\)', key: 'photos', width: 35 }
    ];
    
    // Add SKU rows
    data.skus_detail.forEach((sku, idx) => {
        const row = ws2.addRow({
            codprod: sku.codprod,
            descricao_winthor: sku.descricao_winthor,
            nome_sistema_limpo: sku.nome_sistema_limpo,
            barcode: sku.barcode,
            model: sku.model,
            color_db: sku.color_db,
            size: sku.size,
            unidade: sku.unidade,
            ncm: sku.ncm,
            estoque_20: sku.estoque_20,
            estoque_disp_20: sku.estoque_disp_20,
            peso_liquido: sku.peso_liquido,
            peso_bruto: sku.peso_bruto,
            altura_m3: sku.altura_m3,
            largura_m3: sku.largura_m3,
            comprimento_m3: sku.comprimento_m3,
            photos: sku.photos
        });
        
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.font = defaultFont;
            cell.border = thinBorder;
            cell.alignment = { vertical: 'middle' };
            
            // Align numbers
            if (colNumber === 1 || colNumber === 4) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            }
            if (colNumber >= 10 && colNumber <= 16) {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
        });
        
        // Zebra striping
        if (idx % 2 === 1) {
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = stripeFill;
            });
        }
    });
    
    // Style Header Row for Sheet 2
    const row2 = ws2.getRow(1);
    row2.height = 30;
    row2.eachCell((cell) => {
        cell.font = whiteFont;
        cell.fill = headerFill;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    
    // Save workbook to Desktop
    const desktopPath = 'C:\\Users\\usuario001\\Desktop\\catalogo_softworks_completo.xlsx';
    console.log(`Writing Excel workbook to: ${desktopPath}...`);
    await workbook.xlsx.writeFile(desktopPath);
    console.log('Excel file created successfully!');
}

main().catch(err => console.error('Error generating Excel:', err));
