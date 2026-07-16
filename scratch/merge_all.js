const fs = require('fs');
const path = require('path');

// Helper to determine model from description
const modelsList = ['BB31', 'BB32', 'BB33', 'BB34', 'BB50', 'BB51', 'BB59', 'BB60', 'BB61', 'BB65', 'BB66', 'BB67', 'BB80', 'BB81', 'BB82', 'BB84', 'BB85', 'BB86', 'BB87', 'BB90', 'BB900', 'BB95'];

function getModelFromDesc(desc) {
    const upper = desc.toUpperCase();
    for (const m of modelsList) {
        if (upper.includes(m)) return m;
    }
    // Fallback search for BB followed by digits
    const match = upper.match(/BB\d+/);
    if (match) return match[0];
    return 'OUTROS';
}

// Helper to determine color from description
function getColorFromDesc(desc) {
    const upper = desc.toUpperCase();
    if (upper.includes('BCO2') || upper.includes('BCO 2') || upper.includes('BRANCO2') || upper.includes('BRANCO 2')) {
        return 'BRANCO 2';
    }
    if (upper.includes('PTO2') || upper.includes('PTO 2') || upper.includes('PRETO2') || upper.includes('PRETO 2')) {
        return 'PRETO 2';
    }
    if (upper.includes('BCO') || upper.includes('BRANCO') || upper.includes('WHITE')) {
        return 'BRANCO';
    }
    if (upper.includes('PTO') || upper.includes('PRETO') || upper.includes('BLACK') || upper.includes('PT ')) {
        return 'PRETO';
    }
    if (upper.includes('MRN') || upper.includes('MARINHO') || upper.includes('NAVY')) {
        return 'MARINHO';
    }
    if (upper.includes('ROSA') || upper.includes('PINK')) {
        return 'ROSA';
    }
    if (upper.includes('AMEIXA') || upper.includes('AMX') || upper.includes('PLUM')) {
        return 'AMEIXA';
    }
    if (upper.includes('LAR ') || upper.includes('LARANJA')) {
        return 'LARANJA';
    }
    if (upper.includes('AZUL') || upper.includes('AZU')) {
        return 'AZUL';
    }
    if (upper.includes('VERDE') || upper.includes('VD ')) {
        return 'VERDE';
    }
    
    // Attempt to extract whatever is after the model
    // e.g. "BB60 BABUCHE ANTIDER PTO N.43/44" -> PTO
    return 'OUTRA';
}

// Helper to determine size from description
function getSizeFromDesc(desc) {
    const upper = desc.toUpperCase();
    // Look for N.XX or N.XX/XX
    const match = upper.match(/N\.\s*([0-9/]+)/);
    if (match) return match[1];
    
    // Look for number at the end of string
    const endMatch = upper.match(/\b([3-4][0-9](?:\/[3-4][0-9])?)\b\s*$/);
    if (endMatch) return endMatch[1];
    
    return 'N/A';
}

function cleanDescription(desc, model) {
    let name = desc.toUpperCase();
    
    // Remove model code (e.g. BB80)
    name = name.replace(new RegExp('\\b' + model + '\\b', 'g'), '');
    name = name.replace(/\bBB\d+\b/g, '');
    
    // Remove size pattern (e.g. N.35, N.43/44)
    name = name.replace(/\bN\.\s*[0-9/]+\b/g, '');
    name = name.replace(/\b[3-4][0-9](?:\/[3-4][0-9])?\b\s*$/g, '');
    
    // Remove color terms
    const colorsToRemove = [
        'BCO2', 'BCO 2', 'PTO2', 'PTO 2', 'BCO', 'PTO', 'MRN', 
        'MARINHO2', 'MARINHO', 'ROSA', 'AMEIXA', 'AMX', 
        'LARANJA', 'LAR', 'AZUL', 'VERDE', 'VD', 'BLACK', 'WHITE'
    ];
    colorsToRemove.forEach(c => {
        const regex = new RegExp('\\b' + c + '\\b', 'g');
        name = name.replace(regex, '');
    });
    
    // Expand abbreviations
    const expansions = {
        'ANTIDER': 'ANTIDERRAPANTE',
        'C/BIQ': 'COM BIQUEIRA',
        'S/BIQ': 'SEM BIQUEIRA',
        'C LONGO': 'CANO LONGO',
        'C CURTO': 'CANO CURTO',
        'FEM': 'FEMININO',
        'SEG': 'SEGURANÇA',
        'UNISEX': 'UNISSEX',
        'SAPAT': 'SAPATO',
        'C/PALM': 'COM PALMILHA',
        'SAPATENIS': 'SAPATÊNIS',
        'SEGURANCA': 'SEGURANÇA'
    };
    
    name = name.replace(/\bC\s+LONGO\b/g, 'CANO LONGO');
    name = name.replace(/\bC\s+CURTO\b/g, 'CANO CURTO');
    
    Object.keys(expansions).forEach(abbr => {
        if (abbr !== 'C LONGO' && abbr !== 'C CURTO') {
            const regex = new RegExp('\\b' + abbr.replace('/', '\\/') + '\\b', 'g');
            name = name.replace(regex, expansions[abbr]);
        }
    });
    
    return name.replace(/\s+/g, ' ').trim();
}

function main() {
    const dbPath = path.join(__dirname, 'softworks_db_products_all.json');
    const scrapedPath = path.join(__dirname, 'softworks_scraped.json');
    const photosDir = 'P:\\fotosprodutos';
    
    if (!fs.existsSync(dbPath)) {
        console.error('Database JSON not found! Run get_db_data.js first.');
        return;
    }
    
    if (!fs.existsSync(scrapedPath)) {
        console.error('Scraped JSON not found! Run scrape_softworks.js first.');
        return;
    }
    
    console.log('Loading database products...');
    const dbProducts = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    console.log('Loading scraped website details...');
    const scrapedProducts = JSON.parse(fs.readFileSync(scrapedPath, 'utf8'));
    
    // Map scraped products by model code for fast lookup
    const webModelMap = {};
    scrapedProducts.forEach(wp => {
        if (wp.model) {
            // Note: BB900 on site is BB90 in Winthor
            const key = wp.model.toUpperCase();
            webModelMap[key] = wp;
            if (key === 'BB900') {
                webModelMap['BB90'] = wp;
            }
        }
    });
    
    // Read photo directory
    console.log(`Scanning photos directory: ${photosDir}...`);
    let photoFiles = [];
    try {
        photoFiles = fs.readdirSync(photosDir);
        console.log(`Found ${photoFiles.length} photo files in directory.`);
    } catch (e) {
        console.error('Failed to read photos directory:', e.message);
    }
    
    // Group photos by product code prefix
    // e.g. "12436.png", "12436_2.jpg" -> "12436" -> ["12436.png", "12436_2.jpg"]
    const photoMap = {};
    photoFiles.forEach(file => {
        const lower = file.toLowerCase();
        // Ignore files with 'excluir' or generic placeholders
        if (lower.includes('excluir') || lower.includes('---')) return;
        
        // Extract numeric prefix
        const match = file.match(/^([0-9]+)/);
        if (match) {
            const codprod = match[1];
            if (!photoMap[codprod]) {
                photoMap[codprod] = [];
            }
            photoMap[codprod].push(file);
        }
    });
    
    // Process and merge each product from the database
    console.log('Processing and merging data...');
    const mergedSkus = [];
    
    dbProducts.forEach(p => {
        const model = getModelFromDesc(p.DESCRICAO);
        const color = getColorFromDesc(p.DESCRICAO);
        const size = getSizeFromDesc(p.DESCRICAO);
        
        // Get matched photos
        const codprodStr = String(p.CODPROD);
        const productPhotos = photoMap[codprodStr] || [];
        
        // Get website details
        const webInfo = webModelMap[model] || {};
        
        // Format NCM
        let formattedNcm = p.NCM || '';
        if (formattedNcm.endsWith('.')) formattedNcm = formattedNcm.slice(0, -1);
        if (formattedNcm.length === 8) {
            formattedNcm = `${formattedNcm.slice(0, 4)}.${formattedNcm.slice(4, 6)}.${formattedNcm.slice(6, 8)}`;
        }
        
        const cleanName = cleanDescription(p.DESCRICAO, model);
        
        mergedSkus.push({
            codprod: p.CODPROD,
            descricao_winthor: p.DESCRICAO,
            nome_sistema_limpo: cleanName,
            barcode: p.BARCODE || '',
            unidade: p.UNIDADE || 'PR',
            peso_bruto: p.PESOBRUTO || 0,
            peso_liquido: p.PESOLIQ || 0,
            altura_m3: p.ALTURAM3 || 0,
            largura_m3: p.LARGURAM3 || 0,
            comprimento_m3: p.COMPRIMENTOM3 || 0,
            ncm: formattedNcm,
            estoque_20: p.ESTOQUE_20,
            estoque_disp_20: p.ESTOQUE_DISP_20,
            
            // Parsed from DB description
            model,
            color_db: color,
            size,
            
            // From web
            web_name: webInfo.name || '',
            web_ref: webInfo.ref || '',
            web_ca: webInfo.ca || '',
            web_grade: webInfo.grade || '',
            web_differentials: webInfo.differentials || '',
            web_specs: webInfo.specs || '',
            web_solado: webInfo.solado || '',
            ficha_pdf: webInfo.fichaPdf || '',
            ca_pdf: webInfo.caPdf || '',
            ce_pdf: webInfo.cePdf || '',
            ibetec_pdf: webInfo.ibetecPdf || '',
            
            // From photos
            photos: productPhotos.join(', ')
        });
    });
    
    // Group by model to generate a models summary
    const modelsSummary = {};
    mergedSkus.forEach(sku => {
        const m = sku.model;
        if (!modelsSummary[m]) {
            // Find web specs for this model
            const webInfo = webModelMap[m] || {};
            modelsSummary[m] = {
                model: m,
                name: m + ' - ' + sku.nome_sistema_limpo,
                ca: sku.web_ca || sku.ncm || '', // Use NCM or CA
                grade: webInfo.grade || 'N/A',
                specs: webInfo.specs || '',
                solado: webInfo.solado || '',
                differentials: webInfo.differentials || '',
                ficha_pdf: webInfo.fichaPdf || '',
                ca_pdf: webInfo.caPdf || '',
                ce_pdf: webInfo.cePdf || '',
                ibetec_pdf: webInfo.ibetecPdf || '',
                colors: new Set(),
                skus_count: 0,
                total_stock: 0
            };
        }
        
        modelsSummary[m].colors.add(sku.color_db);
        modelsSummary[m].skus_count++;
        modelsSummary[m].total_stock += sku.estoque_20;
    });
    
    // Convert colors Set to comma-separated string
    const summaryList = Object.values(modelsSummary).map(m => ({
        ...m,
        colors: Array.from(m.colors).join(', ')
    }));
    
    const outputData = {
        models_summary: summaryList,
        skus_detail: mergedSkus
    };
    
    const outputPath = path.join(__dirname, 'softworks_catalog_raw.json');
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
    console.log(`Successfully merged all data into ${outputPath}`);
    console.log(`Total Models: ${summaryList.length}`);
    console.log(`Total SKUs: ${mergedSkus.length}`);
}

main();
