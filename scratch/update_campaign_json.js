const fs = require('fs');
const path = require('path');

const CAMPAIGNS_FILE = path.join(__dirname, '..', 'data', 'campaigns.json');

try {
    const campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));

    // 1. DF
    const campDF = campaigns.find(c => c.id === 'camp-1782403173679');
    if (campDF) {
        campDF.personalizedText = "Campanha da Bom Princípio está no ar! \n\nVou deixar aqui como está *Top 3* até o momento. \n\n*Lista TOP 3*";
        campDF.recipients = ["BRAGO Vendas Comercial Brasília"];
        campDF.cronTime = "30 16 * * 5";
    }

    // 2. GO
    const campGO = campaigns.find(c => c.id === 'camp-1782503421133');
    if (campGO) {
        campGO.personalizedText = "Olá GOIÂNIA! Passando aqui mostrar como está *Top 3* até o momento da campanha da *BOM PRINCIPIO*.";
        campGO.recipients = ["Brago Vendas Comercial Goiânia"];
        campGO.cronTime = "30 16 * * 5";
    }

    // 3. TO
    const campTO = campaigns.find(c => c.id === 'camp-1782503545681');
    if (campTO) {
        campTO.personalizedText = "Olá PALMAS! Passando aqui mostrar como está *Top 3* até o momento da campanha da *BOM PRINCIPIO*.";
        campTO.recipients = ["Comercial Brago TO"];
        campTO.cronTime = "30 16 * * 5";
    }

    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2), 'utf8');
    console.log('✅ campaigns.json atualizado com cronTime e mensagens originais!');
    console.log(JSON.stringify(campaigns.map(c => ({ id: c.id, name: c.name, cron: c.cronTime, text: c.personalizedText })), null, 2));

} catch (err) {
    console.error('Erro ao atualizar campaigns.json:', err.message);
}
