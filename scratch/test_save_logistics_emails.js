const fs = require('fs');
const path = require('path');

async function testSaveSettings() {
    console.log('🧪 Iniciando teste de persistência de e-mails de logística...');
    try {
        // 1. Fetch current settings
        const getRes = await fetch('http://localhost:3001/api/settings');
        if (!getRes.ok) {
            throw new Error(`Falha ao carregar configurações: ${getRes.statusText}`);
        }
        const settings = await getRes.json();
        console.log('✅ Configurações atuais carregadas do servidor.');
        
        // 2. Add test logistics notify emails
        settings.logisticsNotifyEmails = {
            '20 + 6': ['brenan.araujo@bragodistribuidora.com.br', 'logistica.df@bragodistribuidora.com.br'],
            '21': ['logistica.go@bragodistribuidora.com.br'],
            '22': ['logistica.to@bragodistribuidora.com.br'],
            '23': ['logistica.ms@bragodistribuidora.com.br'],
            'GERAL': ['diretoria@bragodistribuidora.com.br']
        };
        
        // 3. Post updated settings
        const postRes = await fetch('http://localhost:3001/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (!postRes.ok) {
            throw new Error(`Falha ao salvar configurações: ${postRes.statusText}`);
        }
        console.log('✅ Novas configurações enviadas com sucesso para /api/settings.');
        
        // 4. Verify settings.json file directly
        const settingsFile = path.join(__dirname, '..', 'data', 'settings.json');
        const savedData = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        
        if (savedData.logisticsNotifyEmails && savedData.logisticsNotifyEmails['20 + 6'].includes('logistica.df@bragodistribuidora.com.br')) {
            console.log('✅ TESTE APROVADO! Configurações de e-mail salvas e lidas com sucesso.');
            console.log('Configurações salvas:');
            console.log(JSON.stringify(savedData.logisticsNotifyEmails, null, 2));
        } else {
            console.error('❌ TESTE FALHOU! Configurações de e-mail não foram persistidas corretamente no arquivo settings.json.');
        }
        
    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
    } finally {
        console.log('🧪 Teste finalizado.');
        process.exit(0);
    }
}

testSaveSettings();
