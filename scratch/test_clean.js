const fs = require('fs');
const path = require('path');

const modelsList = ['BB31', 'BB32', 'BB33', 'BB34', 'BB50', 'BB51', 'BB59', 'BB60', 'BB61', 'BB65', 'BB66', 'BB67', 'BB80', 'BB81', 'BB82', 'BB84', 'BB85', 'BB86', 'BB87', 'BB90', 'BB900', 'BB95'];

function cleanDescription(desc, model) {
    let name = desc.toUpperCase();
    
    // Remove model code (e.g. BB80)
    name = name.replace(new RegExp('\\b' + model + '\\b', 'g'), '');
    // Also remove generic BBxx pattern
    name = name.replace(/\bBB\d+\b/g, '');
    
    // Remove size pattern (e.g. N.35, N.43/44, N. 35)
    name = name.replace(/\bN\.\s*[0-9/]+\b/g, '');
    
    // Remove size pattern without N at the end (e.g. 35, 43/44)
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
    
    // Replace multi-word abbreviations first
    name = name.replace(/\bC\s+LONGO\b/g, 'CANO LONGO');
    name = name.replace(/\bC\s+CURTO\b/g, 'CANO CURTO');
    
    Object.keys(expansions).forEach(abbr => {
        if (abbr !== 'C LONGO' && abbr !== 'C CURTO') {
            const regex = new RegExp('\\b' + abbr.replace('/', '\\/') + '\\b', 'g');
            name = name.replace(regex, expansions[abbr]);
        }
    });
    
    // Clean up whitespace
    name = name.replace(/\s+/g, ' ').trim();
    return name;
}

const rawPath = path.join(__dirname, 'softworks_catalog_raw.json');
if (fs.existsSync(rawPath)) {
    const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    const seenModels = {};
    
    data.skus_detail.forEach(sku => {
        if (!seenModels[sku.model]) {
            seenModels[sku.model] = sku.descricao_winthor;
        }
    });
    
    console.log('Testing description clean-up:');
    for (const m in seenModels) {
        const original = seenModels[m];
        const cleaned = cleanDescription(original, m);
        console.log(`Model ${m}:`);
        console.log(`  Original: "${original}"`);
        console.log(`  Cleaned:  "${m} - ${cleaned}"`);
    }
} else {
    console.log('Catalog raw JSON not found.');
}
