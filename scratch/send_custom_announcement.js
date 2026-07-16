require('dotenv').config();
const { getFilialNumbers } = require('../src/config/groups');
const whatsapp = require('../src/services/whatsappService');
const logger = require('../src/utils/logger');
const http = require('http');

const message = `✨ *Aviso da Bia!* ✨

Olá! Passando aqui rapidinho para te contar, que para o bem do seu WhatsApp (e da bateria do seu celular! 🔋😂).

Vamos diminuir aquele bombardeio de mensagens repetidas e focar no que realmente importa para as suas vendas, a partir de hoje não enviaremos mais alertas de estoque para *garrafas transparentes* (aquelas que ficam indo e vindo entre os nossos centros de distribuição em pequenos lotes 📦🔄).

Não se preocupe: todos os outros produtos continuam sendo notificados normalmente assim que estiverem prontos para venda! 😉

Qualquer dúvida, estou por aqui. Boas vendas! 🚀`;

function controlMonitor(action) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ action });
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: '/api/control',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve({ success: true, data: JSON.parse(body) });
                } else {
                    resolve({ success: false, error: `Status ${res.statusCode}: ${body}` });
                }
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        req.write(data);
        req.end();
    });
}

async function main() {
    const sellers20 = getFilialNumbers('20');
    const sellers21 = getFilialNumbers('21');
    const allSellers = Array.from(new Set([...sellers20, ...sellers21]));

    console.log('=== PREVIEW DA MENSAGEM ===');
    console.log(message);
    console.log('============================\n');

    console.log(`Filial 20: ${sellers20.length} vendedores`);
    console.log(`Filial 21: ${sellers21.length} vendedores`);
    console.log(`Total de números únicos para envio: ${allSellers.length}`);

    const shouldSend = process.argv.includes('--send');
    if (!shouldSend) {
        console.log('\n⚠️ MODO DE SIMULAÇÃO (DRY RUN). Nenhuma mensagem foi enviada.');
        console.log('Para enviar de verdade, rode: node scratch/send_custom_announcement.js --send');
        process.exit(0);
    }

    console.log('\n🛑 Solicitando parada do monitoramento local para liberar sessão...');
    const stopResult = await controlMonitor('stop');
    if (stopResult.success) {
        console.log('✅ Monitor parado com sucesso.');
    } else {
        console.log(`⚠️ Não foi possível parar o monitor (erro: ${stopResult.error}). Continuando mesmo assim...`);
    }

    // Espera 3 segundos para garantir liberação dos arquivos
    await new Promise(r => setTimeout(r, 3000));

    console.log('\n🚀 Iniciando envio real das mensagens...');
    
    // Inicializa o cliente do WhatsApp
    await whatsapp.initialize();
    
    try {
        for (let i = 0; i < allSellers.length; i++) {
            const number = allSellers[i];
            console.log(`[${i + 1}/${allSellers.length}] Enviando para ${number}...`);
            const sent = await whatsapp.sendToNumber(number, message);
            if (sent) {
                console.log(`✅ Enviado com sucesso para ${number}`);
            } else {
                console.error(`❌ Falha ao enviar para ${number}`);
            }
            // Delay de 2 segundos entre envios
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log('\n🎉 Todos os envios concluídos!');
    } catch (err) {
        console.error('Erro durante o envio:', err);
    } finally {
        await whatsapp.destroy();
        
        console.log('\n🔄 Solicitando reinício do monitoramento local...');
        const startResult = await controlMonitor('start');
        if (startResult.success) {
            console.log('✅ Monitor reiniciado com sucesso.');
        } else {
            console.log(`❌ Falha ao reiniciar o monitor: ${startResult.error}`);
        }
        
        process.exit(0);
    }
}

main();
