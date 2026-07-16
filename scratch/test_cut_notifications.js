require('dotenv').config();
const database = require('../src/config/database');
const whatsapp = require('../src/services/whatsappService');
const fs = require('fs');
const path = require('path');

const processedCutsFile = path.join(__dirname, '..', 'data', 'processed_cuts.json');

// Reseta o cache de cortes enviados se a flag --reset for informada
if (process.argv.includes('--reset')) {
    if (fs.existsSync(processedCutsFile)) {
        fs.writeFileSync(processedCutsFile, '[]', 'utf8');
        console.log('🧹 Cache de cortes enviados resetado (processed_cuts.json).');
    }
}

const cutService = require('../src/services/cutService');

async function main() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🧪 Testando Notificações de Corte           ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    await database.initialize();

    const mockEntries = [
        {
            CODPROD: 1361,
            CODFILIAL: '21',
            QTDISP: 10, // Maior que a falta de 6 no pedido 1003020916
            DESCRICAO: 'PRATO P/BOLO MP28 C/BORDA C/200 UN',
            DTDESBLOQUEIO: new Date().toISOString()
        }
    ];

    const shouldSend = process.argv.includes('--send');

    if (!shouldSend) {
        console.log('🔧 MODO DRY-RUN: Mockando WhatsApp para visualizar a mensagem...\n');
        
        // Mock do whatsappService
        whatsapp.isClientReady = () => true;
        whatsapp.sendToNumber = async (number, message) => {
            console.log(`\n📬 [Simulação] Enviando para: ${number}`);
            console.log('--------------------------------------------------');
            console.log(message);
            console.log('--------------------------------------------------\n');
            return true;
        };
    } else {
        console.log('🚀 MODO REAL: Inicializando o WhatsApp para envio real para 5561983391951...\n');
        
        // Inicializa o cliente real
        await whatsapp.initialize();
    }

    try {
        console.log('Chamando cutService.checkAndNotifyCuts com mock de desbloqueios...');
        await cutService.checkAndNotifyCuts(mockEntries);
        console.log('Processamento concluído!');
    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
    } finally {
        if (shouldSend) {
            await whatsapp.destroy();
        }
        await database.close();
        process.exit(0);
    }
}

main();
