const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'rupture_history.json');
if (fs.existsSync(file)) {
    const history = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key in history) {
        if (history[key].dateFirstSeen === '2026-06-07') {
            history[key].dateFirstSeen = '2026-06-08';
        }
    }
    fs.writeFileSync(file, JSON.stringify(history, null, 2), 'utf8');
    console.log('Feito: datas 2026-06-07 corrigidas para 2026-06-08.');
}
