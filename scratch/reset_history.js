const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'rupture_history.json');
if (fs.existsSync(file)) {
    const history = JSON.parse(fs.readFileSync(file, 'utf8'));
    const todayStr = '2026-06-11';
    
    for (const key in history) {
        if (history[key].daysInRupture === 6) {
            history[key].daysInRupture = 4;
        } else if (history[key].daysInRupture === 2) {
            history[key].daysInRupture = 1;
        }
        history[key].lastUpdateDate = todayStr;
    }
    
    fs.writeFileSync(file, JSON.stringify(history, null, 2), 'utf8');
    console.log('Histórico de rupturas corrigido com sucesso.');
} else {
    console.log('Arquivo de histórico não encontrado.');
}
