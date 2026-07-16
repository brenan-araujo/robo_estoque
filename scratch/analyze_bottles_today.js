const fs = require('fs');
const path = require('path');

const sentMessagesPath = 'c:\\Users\\usuario001\\Documents\\api_consulta_estoque\\data\\sent_messages.json';
const data = JSON.parse(fs.readFileSync(sentMessagesPath, 'utf8'));

const bottleMsgs = data.filter(msg => msg.message.includes('GARRAFA TRANSP') && msg.timestamp.startsWith('2026-06-08'));

console.log(`Detalhes dos primeiros 10 envios de hoje contendo "GARRAFA TRANSP":\n`);
bottleMsgs.slice(0, 10).forEach((msg, idx) => {
    console.log(`--- ENVIO ${idx + 1} ---`);
    console.log(`Target: ${msg.target}`);
    console.log(`Timestamp: ${msg.timestamp}`);
    console.log(`Message Snippet:\n${msg.message.substring(0, 300)}...`);
    console.log('──────────────────\n');
});
