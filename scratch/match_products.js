const fs = require('fs');
const path = require('path');

const dbProducts = JSON.parse(fs.readFileSync(path.join(__dirname, 'softworks_db_products.json'), 'utf8'));

// The user's list from the image
const imageRules = {
    'BB50': ['BRANCO', 'PRETO'],
    'BB51': ['BRANCO', 'PRETO'],
    'BB60': ['BRANCO', 'MARINHO', 'PRETO', 'ROSA BEBE'],
    'BB61': ['BRANCO', 'PRETO'],
    'BB65': ['BRANCO', 'PRETO'],
    'BB66': ['BRANCO', 'PRETO'],
    'BB67': ['BRANCO', 'PRETO'],
    'BB80': ['AMEIXA', 'BRANCO', 'BRANCO 2', 'MARINHO', 'PRETO', 'PRETO 2'],
    'BB81': ['BRANCO2', 'MARINHO', 'PRETO', 'PRETO2'], // Note: BRANCO2 and PRETO2 are separate here
    'BB85': ['BRANCO', 'PRETO'],
    'BB86': ['BRANCO', 'PRETO'],
    'BB87': ['BRANCO', 'PRETO'],
    'BB95': ['BRANCO', 'PRETO']
};

function determineProductModel(description) {
    for (const model of Object.keys(imageRules)) {
        if (description.includes(model)) {
            return model;
        }
    }
    return null;
}

function determineProductColor(description) {
    const desc = description.toUpperCase();
    
    // Check for "2" versions first
    if (desc.includes('BCO2') || desc.includes('BCO 2') || desc.includes('BRANCO2') || desc.includes('BRANCO 2')) {
        return 'BRANCO 2';
    }
    if (desc.includes('PTO2') || desc.includes('PTO 2') || desc.includes('PRETO2') || desc.includes('PRETO 2')) {
        return 'PRETO 2';
    }
    
    // Standard versions
    if (desc.includes('BCO') || desc.includes('BRANCO') || desc.includes('WHITE')) {
        return 'BRANCO';
    }
    if (desc.includes('PTO') || desc.includes('PRETO') || desc.includes('PT') || desc.includes('BLACK')) {
        return 'PRETO';
    }
    if (desc.includes('MRN') || desc.includes('MARINHO') || desc.includes('NAVY')) {
        return 'MARINHO';
    }
    if (desc.includes('ROSA') || desc.includes('PINK')) {
        return 'ROSA BEBE';
    }
    if (desc.includes('AMEIXA') || desc.includes('AMX') || desc.includes('PLUM')) {
        return 'AMEIXA';
    }
    
    return null;
}

const matchedProducts = [];

dbProducts.forEach(p => {
    const model = determineProductModel(p.DESCRICAO);
    if (!model) return;
    
    const color = determineProductColor(p.DESCRICAO);
    if (!color) return;
    
    const allowedColors = imageRules[model];
    // Map "BRANCO 2" to "BRANCO 2" or "BRANCO2" to match allowed colors
    let matchedColor = null;
    for (const ac of allowedColors) {
        const cleanAc = ac.replace(/\s+/g, '');
        const cleanColor = color.replace(/\s+/g, '');
        if (cleanAc === cleanColor) {
            matchedColor = ac;
            break;
        }
    }
    
    if (matchedColor) {
        matchedProducts.push({
            ...p,
            MODEL: model,
            COLOR: matchedColor
        });
    }
});

console.log(`Matched ${matchedProducts.length} products out of ${dbProducts.length} Soft Works database products.`);
console.log('Sample matched products:');
console.table(matchedProducts.slice(0, 15));

// Save matched products to a JSON file for processing
fs.writeFileSync(path.join(__dirname, 'matched_products.json'), JSON.stringify(matchedProducts, null, 2), 'utf8');
