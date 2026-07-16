const fs = require('fs');
const path = require('path');

function main() {
    const rawPath = path.join(__dirname, 'softworks_catalog_raw.json');
    if (!fs.existsSync(rawPath)) {
        console.error('Raw catalog JSON not found! Please run merge_all.js first.');
        return;
    }
    
    const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    const sourcePhotosDir = 'P:\\fotosprodutos';
    
    // Define target directories
    const targetDir = 'C:\\Users\\usuario001\\Desktop\\Pasta Completa Soft Works';
    const targetPhotosDir = path.join(targetDir, 'fotos');
    const targetDadosDir = path.join(targetDir, 'dados');
    
    console.log(`Creating directory structure in: ${targetDir}...`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    if (!fs.existsSync(targetPhotosDir)) fs.mkdirSync(targetPhotosDir, { recursive: true });
    if (!fs.existsSync(targetDadosDir)) fs.mkdirSync(targetDadosDir, { recursive: true });
    
    // 1. Copy the Excel Spreadsheet
    const excelSrc = 'C:\\Users\\usuario001\\Desktop\\catalogo_softworks_completo.xlsx';
    const excelDest = path.join(targetDir, 'catalogo_softworks_completo.xlsx');
    if (fs.existsSync(excelSrc)) {
        fs.copyFileSync(excelSrc, excelDest);
        console.log('Copied spreadsheet to catalog folder.');
    } else {
        console.warn('Spreadsheet not found on Desktop to copy.');
    }
    
    // 2. Copy the JSON files
    const jsonFiles = [
        'softworks_db_products_all.json',
        'softworks_scraped.json',
        'softworks_catalog_raw.json'
    ];
    jsonFiles.forEach(file => {
        const src = path.join(__dirname, file);
        const dest = path.join(targetDadosDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(`Copied data file: ${file}`);
        }
    });
    
    // 3. Copy matched product photos
    console.log('Copying matched product photos...');
    let copiedPhotosCount = 0;
    let missingPhotosCount = 0;
    const copiedSet = new Set();
    
    data.skus_detail.forEach(sku => {
        if (!sku.photos) return;
        
        // Parse list of photo files
        const photoFiles = sku.photos.split(',').map(f => f.trim());
        photoFiles.forEach(file => {
            if (!file || copiedSet.has(file)) return;
            
            const srcPath = path.join(sourcePhotosDir, file);
            const destPath = path.join(targetPhotosDir, file);
            
            if (fs.existsSync(srcPath)) {
                try {
                    fs.copyFileSync(srcPath, destPath);
                    copiedSet.add(file);
                    copiedPhotosCount++;
                } catch (e) {
                    console.error(`Error copying photo ${file}:`, e.message);
                }
            } else {
                missingPhotosCount++;
            }
        });
    });
    
    console.log(`\nCopying completed!`);
    console.log(`Total unique photos copied: ${copiedPhotosCount}`);
    if (missingPhotosCount > 0) {
        console.log(`Photos referenced but missing in source: ${missingPhotosCount}`);
    }
    console.log(`All files organized inside: ${targetDir}`);
}

main();
