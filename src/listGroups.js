/**
 * Script utilitário para listar todos os grupos do WhatsApp
 * Rode: npm run list:groups
 * 
 * Use os nomes listados para preencher o arquivo src/config/groups.js
 */
require('dotenv').config();

const whatsapp = require('./services/whatsappService');
const logger = require('./utils/logger');

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  📋 Listar Grupos do WhatsApp               ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    try {
        await whatsapp.initialize();

        console.log('');
        logger.info('Buscando grupos...');
        console.log('');

        const groups = await whatsapp.listAllGroups();

        if (groups.length === 0) {
            logger.warn('Nenhum grupo encontrado!');
        } else {
            console.log('┌─────────────────────────────────────────────────────────────┐');
            console.log('│  GRUPOS DISPONÍVEIS                                        │');
            console.log('├─────────────────────────────────────────────────────────────┤');
            
            groups.forEach((g, i) => {
                const name = g.name.substring(0, 50).padEnd(50);
                console.log(`│  ${String(i + 1).padStart(3)}. ${name}   │`);
            });
            
            console.log('└─────────────────────────────────────────────────────────────┘');
            console.log('');
            console.log(`Total: ${groups.length} grupo(s)`);
            console.log('');
            console.log('📝 Copie o nome EXATO do grupo e cole em src/config/groups.js');
            console.log('   para a filial correspondente.');
        }

    } catch (err) {
        logger.error(`Erro: ${err.message}`);
    } finally {
        await whatsapp.destroy();
        process.exit(0);
    }
}

main();
