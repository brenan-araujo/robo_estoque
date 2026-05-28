require('dotenv').config();
const database = require('./config/database');
const { getNewEntries, groupByFilial, formatMessage } = require('./services/oracleService');
const { getLastTransId } = require('./utils/stateManager');
const logger = require('./utils/logger');

async function main() {
    await database.initialize();
    const lastTrans = getLastTransId();
    console.log(`\nTestando com NUMTRANSENT > ${lastTrans}\n`);
    const entries = await getNewEntries(lastTrans);
    console.log(`Resultado: ${entries.length} entradas com estoque zerado`);
    if (entries.length > 0) {
        const grouped = groupByFilial(entries);
        for (const [filial, data] of Object.entries(grouped)) {
            console.log(formatMessage(filial, data));
        }
    }
    await database.close();
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
