const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SENT_FILE = path.join(__dirname, '..', '..', 'data', 'sent_messages.json');
const DATA_DIR = path.dirname(SENT_FILE);
const MAX_HISTORY = 2000;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Retorna o histórico de mensagens enviadas
 */
function getSentHistory() {
    ensureDataDir();
    try {
        if (fs.existsSync(SENT_FILE)) {
            const data = fs.readFileSync(SENT_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        logger.warn(`Erro ao ler sent_messages.json: ${err.message}. Retornando lista vazia.`);
    }
    return [];
}

/**
 * Adiciona uma nova mensagem enviada ao histórico
 */
function trackSent(type, target, message, itemCount = 0, details = {}) {
    ensureDataDir();
    try {
        const history = getSentHistory();
        const entry = {
            id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
            timestamp: new Date().toISOString(),
            type, // 'group' | 'number'
            target, // nome do grupo ou número de telefone
            message,
            itemCount,
            details // ex: { codFilial: '20' }
        };
        
        history.unshift(entry); // Adiciona no início (mais recente primeiro)
        
        if (history.length > MAX_HISTORY) {
            history.length = MAX_HISTORY;
        }

        fs.writeFileSync(SENT_FILE, JSON.stringify(history, null, 2), 'utf8');
        return true;
    } catch (err) {
        logger.error(`Erro ao registrar envio no histórico: ${err.message}`);
        return false;
    }
}

module.exports = { trackSent, getSentHistory };
