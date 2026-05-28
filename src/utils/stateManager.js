const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json');
const DATA_DIR = path.dirname(STATE_FILE);

/**
 * Garante que o diretório data/ existe
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Lê a data do último desbloqueio processado
 */
function getLastUnlockDate() {
    ensureDataDir();
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            return data.lastUnlockDate || null;
        }
    } catch (err) {
        logger.warn(`Erro ao ler state.json: ${err.message}. Iniciando do zero.`);
    }
    return null;
}

/**
 * Salva a data do último desbloqueio processado
 */
function saveLastUnlockDate(isoDateStr) {
    ensureDataDir();
    const data = {
        lastUnlockDate: isoDateStr,
        updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
    logger.debug(`Estado salvo: lastUnlockDate = ${isoDateStr}`);
}

module.exports = { getLastUnlockDate, saveLastUnlockDate };
