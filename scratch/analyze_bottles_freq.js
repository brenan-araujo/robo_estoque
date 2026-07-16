const fs = require('fs');
const path = require('path');

const sentMessagesPath = 'c:\\Users\\usuario001\\Documents\\api_consulta_estoque\\data\\sent_messages.json';
const data = JSON.parse(fs.readFileSync(sentMessagesPath, 'utf8'));

// Contadores de mensagens contendo "GARRAFA TRANSP"
let totalCount = 0;
const messagesByDate = {};

for (const msg of data) {
    if (msg.message.includes('GARRAFA TRANSP')) {
        totalCount++;
        const dateStr = msg.timestamp.split('T')[0];
        messagesByDate[dateStr] = (messagesByDate[dateStr] || 0) + 1;
    }
}

console.log(`Total de envios com "GARRAFA TRANSP": ${totalCount}`);
console.log('Envios por data:');
console.table(messagesByDate);
