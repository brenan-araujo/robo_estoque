require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const logger = require('../src/utils/logger');
const whatsapp = require('../src/services/whatsappService');
const contactsManager = require('../src/utils/contactsManager');

// Porta do servidor a partir do .env (fallback 3001)
const PORT = process.env.PORT || 3001;

function controlMonitor(action) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ action });
        const req = http.request({
            hostname: 'localhost',
            port: PORT,
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

const getFirstName = (fullName) => {
    if (!fullName) return 'vendedor';
    const firstWord = fullName.trim().split(/\s+/)[0];
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
};

const formatCutsBlock = (pedidos) => {
    return pedidos.map(ped => {
        const itemsList = ped.items.map(item => {
            return `${item.codprod} - ${item.descricao} (Qtd: ${item.qt_falta}) \n  - *Estq Disp: ${item.qtDisp}un*`;
        }).join('\n');
        return `👤 *Cliente:* ${ped.codcli} - ${ped.cliente} \n📝 *Pedido:* ${ped.numped} \n\n📦 *Itens do corte:* \n\n${itemsList}`;
    }).join('\n\n──────────────────────────\n\n');
};

const fictitiousExample = `👤 *Cliente:* 99999 - MERCADO EXEMPLO LTDA
📝 *Pedido:* 2002001234

📦 *Itens do corte:*

12345 - AMACIANTE CONCENTRADO BRAGO 5L (Qtd: 3)
  - *Estq Disp: 10un*`;

async function main() {
    // 1. Carrega contatos e histórico de mensagens
    const contacts = contactsManager.getContacts();
    let sellers = contacts.filter(c => c.role === 'vendedor' && c.phone);
    
    // Suporte para filtro de vendedor específico (ex: --only=karoline)
    const onlyParam = process.argv.find(arg => arg.startsWith('--only='));
    if (onlyParam) {
        const targetName = onlyParam.split('=')[1].toLowerCase();
        sellers = sellers.filter(s => s.name.toLowerCase().includes(targetName));
    } else {
        // Exclui Karoline e Guilherme que já receberam no teste real
        const alreadySent = ['5561999980681', '5561998003477'];
        sellers = sellers.filter(s => !alreadySent.includes(s.phone));
    }
    
    let sentMessages = [];
    const sentHistoryPath = path.join(__dirname, '..', 'data', 'sent_messages.json');
    if (fs.existsSync(sentHistoryPath)) {
        try {
            sentMessages = JSON.parse(fs.readFileSync(sentHistoryPath, 'utf8'));
        } catch (e) {
            console.error('Erro ao ler histórico de mensagens:', e.message);
        }
    }

    // Filtra mensagens de corte resolvido das últimas 48 horas (corte resolvido)
    const cutResolvedMessages = sentMessages.filter(m => {
        if (!m.details || m.details.type !== 'cut_resolved' || !m.timestamp) return false;
        const diffMs = new Date() - new Date(m.timestamp);
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours <= 48; // Últimas 48 horas (hoje ou ontem)
    });

    console.log(`Carregados ${sellers.length} vendedores.`);
    console.log(`Carregadas ${cutResolvedMessages.length} notificações de cortes resolvidos nas últimas 48h.`);

    // 2. Prepara mensagens personalizadas para cada vendedor
    const preparedMessages = [];
    let realCasesCount = 0;
    let fictitiousCasesCount = 0;

    for (const seller of sellers) {
        const firstName = getFirstName(seller.name);
        
        // Determina os códigos de RCA do vendedor
        const rcaCodes = seller.rcaCode ? seller.rcaCode.split(',').map(r => r.trim()) : [];
        
        // Tenta achar um caso real desse vendedor nas últimas 48 horas
        const realCaseMsg = cutResolvedMessages.find(m => {
            const msgRca = String(m.details.rca).trim();
            return rcaCodes.includes(msgRca);
        });

        // Monta a Mensagem 1
        const message1 = `✨ Novidade por aqui! (E das boas!) ✨

Olá! 🙋‍♀️
Tudo bem, ${firstName}?

Passando para avisar que, a partir de hoje, meu trabalho ficou um pouquinho mais inteligente (e o seu, bem mais fácil)! 🧠💡

Sempre que um produto que foi cortado por falta de estoque no seu pedido voltar a ficar disponível, eu vou te mandar um alerta automático aqui no WhatsApp na mesma hora!

Chega de ficar consultando o estoque de 5 em 5 minutos, agora eu faço a ronda e te aviso:

👤 Qual cliente teve o corte resolvido
📝 O número do pedido original
📦 E quais itens chegaram, com a quantidade disponível no momento

Assim você pode falar com o cliente na velocidade da luz ⚡ e garantir aquela venda!`;

        // Monta a Mensagem 2
        let message2 = '';
        let hasRealCase = false;
        
        if (realCaseMsg && realCaseMsg.details.pedidos && realCaseMsg.details.pedidos.length > 0) {
            const cutsBlock = formatCutsBlock(realCaseMsg.details.pedidos);
            
            // Determina dinamicamente se o caso real ocorreu hoje ou ontem
            const msgDate = new Date(realCaseMsg.timestamp);
            const today = new Date();
            const isToday = msgDate.getDate() === today.getDate() && 
                            msgDate.getMonth() === today.getMonth() && 
                            msgDate.getFullYear() === today.getFullYear();
            const dayTerm = isToday ? 'hoje' : 'ontem';

            message2 = `Veja um exemplo *REAL* na prática do que aconteceu ${dayTerm}:\n\n${cutsBlock}\n\nÓtimo, né? Boas vendas por aí! 🚀`;
            hasRealCase = true;
            realCasesCount++;
        } else {
            message2 = `Veja um exemplo de mensagem que vamos enviar:\n\n${fictitiousExample}\n\nÓtimo, né? Boas vendas por aí! 🚀`;
            fictitiousCasesCount++;
        }

        preparedMessages.push({
            seller,
            firstName,
            hasRealCase,
            message1,
            message2
        });
    }

    // 3. Salva a prévia em formato legível para o usuário revisar
    const previewFile = path.join(__dirname, '..', 'scratch', 'announcement_preview.md');
    let previewContent = `# Prévia do Lançamento do Alerta de Cortes (Bia)\n\n`;
    previewContent += `Total de vendedores: **${sellers.length}**  \n`;
    previewContent += `Exemplos reais (hoje/ontem): **${realCasesCount}**  \n`;
    previewContent += `Exemplos fictícios (modelo): **${fictitiousCasesCount}**\n\n`;
    previewContent += `--- \n\n`;

    preparedMessages.forEach((pm, idx) => {
        previewContent += `## Vendedor [${idx + 1}/${sellers.length}]: ${pm.seller.name} (${pm.seller.phone}) - RCA ${pm.seller.rcaCode}\n`;
        previewContent += `*Tipo de Exemplo:* ${pm.hasRealCase ? '✅ **REAL (Hoje/Ontem)**' : '⚠️ **FICTÍCIO (Modelo)**'}\n\n`;
        previewContent += `### 📱 MENSAGEM 1\n\`\`\`\n${pm.message1}\n\`\`\`\n\n`;
        previewContent += `### 📱 MENSAGEM 2\n\`\`\`\n${pm.message2}\n\`\`\`\n\n`;
        previewContent += `--- \n\n`;
    });

    fs.writeFileSync(previewFile, previewContent, 'utf8');
    console.log(` Prévia detalhada gerada em: scratch/announcement_preview.md`);

    // 4. Se não tiver flag --send, apenas simula
    const shouldSend = process.argv.includes('--send');
    if (!shouldSend) {
        console.log('\n⚠️ MODO DE SIMULAÇÃO (DRY RUN). Nenhuma mensagem enviada.');
        console.log('Revise o arquivo scratch/announcement_preview.md para validar os textos.');
        console.log('Para enviar de verdade, execute: node scratch/send_launch_announcement.js --send');
        process.exit(0);
    }

    // 5. Envio real
    console.log('\n🛑 Solicitando parada do monitoramento local para liberar sessão...');
    const stopResult = await controlMonitor('stop');
    if (stopResult.success) {
        console.log('✅ Monitor parado com sucesso.');
    } else {
        console.log(`⚠️ Não foi possível parar o monitor (erro: ${stopResult.error}). Continuando mesmo assim...`);
    }

    // Espera 3 segundos para garantir liberação dos arquivos
    await new Promise(r => setTimeout(r, 3000));

    console.log('\n🚀 Inicializando cliente do WhatsApp...');
    await whatsapp.initialize();

    try {
        for (let i = 0; i < preparedMessages.length; i++) {
            const pm = preparedMessages[i];
            console.log(`\n[${i + 1}/${preparedMessages.length}] Enviando para ${pm.seller.name} (${pm.seller.phone})...`);
            
            // Envia Mensagem 1
            const sent1 = await whatsapp.sendToNumber(pm.seller.phone, pm.message1);
            if (sent1) {
                console.log(`  ✅ Mensagem 1 enviada.`);
            } else {
                console.error(`  ❌ Falha ao enviar Mensagem 1.`);
            }
            
            // Pequeno intervalo entre mensagem 1 e 2
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Envia Mensagem 2
            const sent2 = await whatsapp.sendToNumber(pm.seller.phone, pm.message2);
            if (sent2) {
                console.log(`  ✅ Mensagem 2 enviada.`);
            } else {
                console.error(`  ❌ Falha ao enviar Mensagem 2.`);
            }

            // Intervalo aleatório de 8 a 15 segundos antes do próximo vendedor para segurança contra spam
            const randomDelay = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
            console.log(`  Aguardando ${Math.round(randomDelay / 1000)}s antes do próximo vendedor...`);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        }
        console.log('\n🎉 Envio do broadcast de lançamento concluído!');
    } catch (err) {
        console.error('Erro durante o envio do broadcast:', err);
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

main().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
