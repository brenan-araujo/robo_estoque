const fs = require('fs');
const path = require('path');

const matched = JSON.parse(fs.readFileSync(path.join(__dirname, 'matched_products.json'), 'utf8'));

const softWorksRules = {
    'BB50': ['BRANCO', 'PRETO'],
    'BB51': ['BRANCO', 'PRETO'],
    'BB60': ['BRANCO', 'MARINHO', 'PRETO', 'ROSA BEBE'],
    'BB61': ['BRANCO', 'PRETO'],
    'BB65': ['BRANCO', 'PRETO'],
    'BB66': ['BRANCO', 'PRETO'],
    'BB67': ['BRANCO', 'PRETO'],
    'BB80': ['AMEIXA', 'BRANCO', 'BRANCO 2', 'MARINHO', 'PRETO', 'PRETO 2'],
    'BB81': ['BRANCO2', 'MARINHO', 'PRETO', 'PRETO2'],
    'BB85': ['BRANCO', 'PRETO'],
    'BB86': ['BRANCO', 'PRETO'],
    'BB87': ['BRANCO', 'PRETO'],
    'BB95': ['BRANCO', 'PRETO']
};

function matchesSoftWorksRules(description) {
    const desc = description.toUpperCase();
    
    let matchedModel = null;
    for (const model of Object.keys(softWorksRules)) {
        if (desc.includes(model)) {
            matchedModel = model;
            break;
        }
    }
    if (!matchedModel) return null;
    
    let color = null;
    if (desc.includes('BCO2') || desc.includes('BCO 2') || desc.includes('BRANCO2') || desc.includes('BRANCO 2')) {
        color = 'BRANCO 2';
    } else if (desc.includes('PTO2') || desc.includes('PTO 2') || desc.includes('PRETO2') || desc.includes('PRETO 2')) {
        color = 'PRETO 2';
    } else if (desc.includes('BCO') || desc.includes('BRANCO') || desc.includes('WHITE')) {
        color = 'BRANCO';
    } else if (desc.includes('PTO') || desc.includes('PRETO') || desc.includes('PT') || desc.includes('BLACK')) {
        color = 'PRETO';
    } else if (desc.includes('MRN') || desc.includes('MARINHO') || desc.includes('NAVY')) {
        color = 'MARINHO';
    } else if (desc.includes('ROSA') || desc.includes('PINK')) {
        color = 'ROSA BEBE';
    } else if (desc.includes('AMEIXA') || desc.includes('AMX') || desc.includes('PLUM')) {
        color = 'AMEIXA';
    }
    if (!color) return null;
    
    const allowed = softWorksRules[matchedModel];
    const cleanColor = color.replace(/\s+/g, '');
    const isAllowed = allowed.some(ac => ac.replace(/\s+/g, '') === cleanColor);
    
    return isAllowed ? { model: matchedModel, color } : null;
}

const seen = new Set();
const uniqueMatched = [];

matched.forEach(p => {
    const match = matchesSoftWorksRules(p.DESCRICAO);
    if (!match) return;
    
    const key = `${match.model}_${match.color}`;
    if (!seen.has(key)) {
        seen.add(key);
        uniqueMatched.push({
            ...p,
            MODEL: match.model,
            COLOR: match.color
        });
    }
});

console.log(`Deduplicated: ${uniqueMatched.length} unique products out of ${matched.length} matched products.`);
console.log('List of unique products (1 per model + color):');
console.table(uniqueMatched.map(u => ({
    CODPROD: u.CODPROD,
    DESCRICAO: u.DESCRICAO,
    MODEL: u.MODEL,
    COLOR: u.COLOR
})));

fs.writeFileSync(path.join(__dirname, 'unique_softworks_to_sync.json'), JSON.stringify(uniqueMatched, null, 2), 'utf8');
