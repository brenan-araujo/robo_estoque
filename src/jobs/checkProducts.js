const fs = require('fs');
const path = require('path');
const { getNewEntries, groupByFilial, formatMessage } = require('../services/oracleService');
const whatsapp = require('../services/whatsappService');
const { getGroupNameForFilial, NOTIFY_NUMBERS } = require('../config/groups');
const { getLastUnlockDate, saveLastUnlockDate } = require('../utils/stateManager');
const logger = require('../utils/logger');

const PROCESSED_KEYS_FILE = path.join(__dirname, '..', '..', 'data', 'processed_keys.json');
let processedKeys = new Set();

// Carrega chaves processadas do disco para suportar reinicializações
try {
    const dir = path.dirname(PROCESSED_KEYS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(PROCESSED_KEYS_FILE)) {
        processedKeys = new Set(JSON.parse(fs.readFileSync(PROCESSED_KEYS_FILE, 'utf8')));
    }
} catch (e) {
    logger.warn(`Erro ao carregar processed_keys.json: ${e.message}`);
}

function saveProcessedKeys() {
    try {
        fs.writeFileSync(PROCESSED_KEYS_FILE, JSON.stringify([...processedKeys]), 'utf8');
    } catch (e) {
        logger.error(`Erro ao salvar processed_keys.json: ${e.message}`);
    }
}

let isRunning = false;

/**
 * Job principal: verifica novos desbloqueios e envia notificações
 */
async function checkNewProducts() {
    // Evita execuções sobrepostas
    if (isRunning) {
        logger.debug('Job anterior ainda em execução, pulando...');
        return;
    }

    isRunning = true;

    try {
        // 1. Pega a data do último desbloqueio processado
        const lastUnlockDate = getLastUnlockDate();
        logger.debug(`Verificando desbloqueios com DTDESBLOQUEIO >= ${lastUnlockDate}`);

        // 2. Busca novas entradas no Oracle
        const rawEntries = await getNewEntries(lastUnlockDate);

        // Filtra chaves duplicadas
        const entries = rawEntries.filter(entry => {
            const key = `${entry.NUMTRANSENT}-${entry.CODPROD}`;
            return !processedKeys.has(key);
        });

        if (entries.length === 0) {
            logger.debug('Nenhum novo desbloqueio encontrado');
            return;
        }

        logger.info(`🆕 ${entries.length} novo(s) desbloqueio(s) encontrado(s)!`);

        // 3. Agrupa por filial
        const grouped = groupByFilial(entries);

        // 4. Envia mensagem para cada filial
        const sentSuccessByFilial = {};

        for (const [codFilial, data] of Object.entries(grouped)) {
            // Monta a mensagem
            const message = formatMessage(codFilial, data);
            let filialSuccess = true;

            // 4a. Envia para o grupo da filial (se configurado)
            const groupName = getGroupNameForFilial(codFilial);
            if (groupName) {
                if (whatsapp.isClientReady()) {
                    const sent = await whatsapp.sendToGroup(groupName, message, data.items.length, { codFilial });
                    if (sent) {
                        logger.info(`✅ Grupo: Filial ${codFilial} → "${groupName}" (${data.items.length} produtos)`);
                    } else {
                        filialSuccess = false;
                        logger.error(`❌ Falha ao enviar para o grupo "${groupName}" da Filial ${codFilial}`);
                    }
                } else {
                    filialSuccess = false;
                    logger.warn(`⚠️ WhatsApp não está pronto para enviar para o grupo da Filial ${codFilial}`);
                }
                await sleep(1500);
            }

            // 4b. Envia para números pessoais (sempre)
            if (NOTIFY_NUMBERS.length > 0) {
                for (const number of NOTIFY_NUMBERS) {
                    if (whatsapp.isClientReady()) {
                        const sent = await whatsapp.sendToNumber(number, message, data.items.length, { codFilial });
                        if (sent) {
                            logger.info(`✅ Número: Filial ${codFilial} → ${number} (${data.items.length} produtos)`);
                        } else {
                            if (!whatsapp.isClientReady()) {
                                filialSuccess = false;
                                logger.error(`❌ Falha ao enviar para ${number} devido a erro no cliente WhatsApp`);
                            } else {
                                logger.warn(`⚠️ Falha ao enviar para número ${number} (possivelmente número inválido ou não registrado)`);
                            }
                        }
                    } else {
                        filialSuccess = false;
                        logger.warn(`⚠️ WhatsApp não está pronto para enviar para número ${number}`);
                    }
                    await sleep(1500);
                }
            }

            sentSuccessByFilial[codFilial] = filialSuccess;
        }

        // 5. Calcula a maior data de desbloqueio segura para salvar
        // Ordena por DTDESBLOQUEIO crescente
        const sortedEntries = [...entries].sort((a, b) => new Date(a.DTDESBLOQUEIO) - new Date(b.DTDESBLOQUEIO));
        
        let newLastUnlockDate = lastUnlockDate;
        for (const entry of sortedEntries) {
            const filial = String(entry.CODFILIAL);
            if (sentSuccessByFilial[filial]) {
                newLastUnlockDate = entry.DTDESBLOQUEIO;
                // Registra como processado
                const key = `${entry.NUMTRANSENT}-${entry.CODPROD}`;
                processedKeys.add(key);
            } else {
                logger.warn(`⚠️ Parando avanço do ponteiro DTDESBLOQUEIO em ${newLastUnlockDate} devido a falha no envio da Filial ${filial} (item ${entry.CODPROD}, Trans: ${entry.NUMTRANSENT})`);
                break;
            }
        }

        // Limita o tamanho do cache de chaves processadas
        if (processedKeys.size > 1000) {
            const arr = [...processedKeys];
            processedKeys = new Set(arr.slice(arr.length - 500));
        }
        saveProcessedKeys();

        // Salva o novo estado se avançou
        if (newLastUnlockDate && newLastUnlockDate !== lastUnlockDate) {
            const isoStr = new Date(newLastUnlockDate).toISOString();
            saveLastUnlockDate(isoStr);
            logger.info(`💾 Estado atualizado: lastUnlockDate = ${isoStr}`);
        }

    } catch (err) {
        logger.error(`❌ Erro no job: ${err.message}`);
    } finally {
        isRunning = false;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { checkNewProducts };
