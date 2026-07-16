const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'rupture_history.json');
if (fs.existsSync(file)) {
    const history = JSON.parse(fs.readFileSync(file, 'utf8'));
    const migrated = {};
    
    for (const key in history) {
        const entry = history[key];
        const days = entry.daysInRupture || 1;
        
        // Calcular dateFirstSeen real como hoje - (days - 1)
        const dateObj = new Date();
        dateObj.setDate(dateObj.getDate() - (days - 1));
        const firstSeenStr = dateObj.toISOString().split('T')[0];
        
        migrated[key] = {
            dateFirstSeen: firstSeenStr
        };
    }
    
    fs.writeFileSync(file, JSON.stringify(migrated, null, 2), 'utf8');
    console.log('Migração do histórico de rupturas concluída com sucesso.');
} else {
    console.log('Arquivo de histórico não encontrado para migração.');
}
