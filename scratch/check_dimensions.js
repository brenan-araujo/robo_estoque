const fs = require('fs');
const path = require('path');

const matched = JSON.parse(fs.readFileSync(path.join(__dirname, 'matched_products.json'), 'utf8'));

const zeroOrNull = matched.filter(p => 
    p.ALTURAM3 === null || p.ALTURAM3 === 0 ||
    p.LARGURAM3 === null || p.LARGURAM3 === 0 ||
    p.COMPRIMENTOM3 === null || p.COMPRIMENTOM3 === 0
);

console.log(`Total matched products: ${matched.length}`);
console.log(`Matched products with zero/null dimensions: ${zeroOrNull.length}`);
console.log('Zero/null dimension products:');
console.table(zeroOrNull);
