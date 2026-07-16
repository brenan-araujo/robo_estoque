const fs = require('fs');
const path = require('path');

const sentMessagesPath = 'c:\\Users\\usuario001\\Documents\\api_consulta_estoque\\data\\sent_messages.json';
const data = JSON.parse(fs.readFileSync(sentMessagesPath, 'utf8'));

const bottleMsgs = data.filter(msg => msg.message.includes('GARRAFA TRANSP') && msg.timestamp.startsWith('2026-06-08'));

// Mapa para agrupar por conteúdo de mensagem limpa (sem rodapé)
const uniqueMessages = {};

for (const msg of bottleMsgs) {
    const cleanMsg = msg.message.replace(/───────────────*[\s\S]*$/, '').trim();
    if (!uniqueMessages[cleanMsg]) {
        uniqueMessages[cleanMsg] = [];
    }
    uniqueMessages[cleanMsg].push(msg.target);
}

console.log(`Número de mensagens com conteúdos distintos contendo "GARRAFA TRANSP" hoje: ${Object.keys(uniqueMessages).length}\n`);

let idx = 1;
for (const [cleanMsg, targets] of Object.entries(uniqueMessages)) {
    console.log(`--- MENSAGEM ÚNICA ${idx++} (Enviada para ${targets.length} contatos) ---`);
    console.log(cleanMsg);
    console.log(`Contatos notificados: ${targets.slice(0, 5).join(', ')} ... (total: ${targets.length})\n`);
}
