require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function triggerBrenanOnly() {
    console.log('🧪 Disparando relatório de Quarta-Feira APENAS para Brenan...');
    
    const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
    const settingsBackup = fs.readFileSync(settingsPath, 'utf8');
    
    try {
        const settings = JSON.parse(settingsBackup);

        // Sobrescrever temporariamente: só Brenan (WhatsApp + e-mail)
        settings.logisticsNotifyNumbers = {
            '20 + 6': ['5561983391951'], // Brenan WhatsApp
            '21': [],
            '22': [],
            '23': [],
            'GERAL': []
        };

        settings.logisticsNotifyEmails = {
            '20 + 6': ['brenan.araujo@bragodistribuidora.com.br'],
            '21': [],
            '22': [],
            '23': [],
            'GERAL': []
        };

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        console.log('⚙️ Configurações temporárias: apenas Brenan (20+6).');

        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('🚀 Chamando /api/logistics/send-whatsapp (isFriday=false = Relatório de Quarta)...');
        const res = await fetch('http://localhost:3001/api/logistics/send-whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runAutomated: true, isFriday: false })
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const data = await res.json();
        console.log('\n✅ Resultado:', JSON.stringify(data, null, 2));

    } catch (err) {
        console.error('❌ Erro:', err.message);
    } finally {
        fs.writeFileSync(settingsPath, settingsBackup, 'utf8');
        console.log('\n⚙️ Configurações originais restauradas.');
        process.exit(0);
    }
}

triggerBrenanOnly();
