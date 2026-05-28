/**
 * Script de teste: verifica conexão Oracle e simula uma verificação
 * Rode: npm run test:oracle
 */
require('dotenv').config();

const database = require('./config/database');
const { getNewEntries, groupByFilial, formatMessage, testConnection } = require('./services/oracleService');
const { getLastTransId } = require('./utils/stateManager');
const logger = require('./utils/logger');

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🧪 Teste de Conexão Oracle                 ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    try {
        // 1. Inicializa e testa conexão
        await database.initialize();
        await testConnection();

        // 2. Mostra estado atual
        const lastTrans = getLastTransId();
        console.log(`\n📊 Último NUMTRANSENT salvo: ${lastTrans}`);

        // 3. Simula uma busca
        console.log('\n🔍 Buscando entradas pendentes...\n');
        const entries = await getNewEntries(lastTrans);

        if (entries.length === 0) {
            console.log('✅ Nenhuma entrada nova desde o último check.');
        } else {
            console.log(`🆕 ${entries.length} entrada(s) encontrada(s)!\n`);

            // Agrupa e mostra
            const grouped = groupByFilial(entries);

            for (const [codFilial, data] of Object.entries(grouped)) {
                const msg = formatMessage(codFilial, data);
                console.log('─'.repeat(50));
                console.log(msg);
                console.log('');
            }
        }

    } catch (err) {
        logger.error(`Erro: ${err.message}`);
    } finally {
        await database.close();
        process.exit(0);
    }
}

main();
