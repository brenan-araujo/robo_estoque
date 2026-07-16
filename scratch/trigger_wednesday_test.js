const fs = require('fs');
const path = require('path');

async function triggerWednesdayTest() {
    console.log('🧪 Iniciando disparo de teste do Relatório de Quarta-Feira (Hoje)...');
    
    const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
    const settingsBackup = fs.readFileSync(settingsPath, 'utf8');
    
    try {
        // 1. Ler e modificar configurações temporariamente
        const settings = JSON.parse(settingsBackup);
        const testNumbers = ['5561983391951', '5561998097323']; // Brenan e Rivelino
        
        settings.logisticsNotifyNumbers = {
            '20 + 6': testNumbers,
            '21': testNumbers,
            '22': testNumbers,
            '23': testNumbers,
            'GERAL': []
        };
        
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        console.log('⚙️ Configurações temporárias aplicadas (redirecionando relatórios para Brenan e Rivelino).');
        
        // Espera rápida para garantir que o arquivo seja percebido
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 2. Chamar endpoint para rodar a rotina de quarta-feira (isFriday = false)
        console.log('🚀 Chamando API /api/logistics/send-whatsapp para execução automatizada...');
        const res = await fetch('http://localhost:3001/api/logistics/send-whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runAutomated: true, isFriday: false })
        });
        
        if (!res.ok) {
            throw new Error(`Falha na requisição: ${res.statusText}`);
        }
        
        const data = await res.json();
        console.log('✅ Execução concluída!', JSON.stringify(data, null, 2));

    } catch (err) {
        console.error('❌ Erro no trigger:', err.message);
    } finally {
        // 3. Restaurar configurações originais
        fs.writeFileSync(settingsPath, settingsBackup, 'utf8');
        console.log('⚙️ Configurações originais restauradas com sucesso.');
        process.exit(0);
    }
}

triggerWednesdayTest();
