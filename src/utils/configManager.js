const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');
const DATA_DIR = path.dirname(SETTINGS_FILE);

const DEFAULT_SETTINGS = {
    pollIntervalMinutes: 1,
    notifyNumbers: [
        '5561983391951',
        '5561998097323',
        '5561999797868'
    ],
    filialGroups: {
        '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '', '10': '',
        '11': '', '12': '', '13': '', '20': '', '21': '', '22': '', '23': '', '24': ''
    },
    filialNumbers: {
        '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '', '10': '',
        '11': '', '12': '', '13': '', '20': '', '21': '', '22': '', '23': '', '24': ''
    }
};

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Carrega as configurações vigentes
 */
function getSettings() {
    ensureDataDir();
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const parsed = JSON.parse(fileContent);
            // Faz um merge com os padrões caso falte alguma chave
            return {
                pollIntervalMinutes: parsed.pollIntervalMinutes !== undefined ? parsed.pollIntervalMinutes : DEFAULT_SETTINGS.pollIntervalMinutes,
                notifyNumbers: Array.isArray(parsed.notifyNumbers) ? parsed.notifyNumbers : DEFAULT_SETTINGS.notifyNumbers,
                filialGroups: { ...DEFAULT_SETTINGS.filialGroups, ...parsed.filialGroups },
                filialNumbers: { ...DEFAULT_SETTINGS.filialNumbers, ...parsed.filialNumbers || {} }
            };
        }
    } catch (err) {
        logger.warn(`Erro ao ler settings.json: ${err.message}. Usando padrões.`);
    }
    return { ...DEFAULT_SETTINGS };
}

/**
 * Salva as novas configurações
 */
function saveSettings(settings) {
    ensureDataDir();
    try {
        const toSave = {
            pollIntervalMinutes: parseInt(settings.pollIntervalMinutes) || DEFAULT_SETTINGS.pollIntervalMinutes,
            notifyNumbers: Array.isArray(settings.notifyNumbers) ? settings.notifyNumbers : DEFAULT_SETTINGS.notifyNumbers,
            filialGroups: typeof settings.filialGroups === 'object' ? settings.filialGroups : DEFAULT_SETTINGS.filialGroups,
            filialNumbers: typeof settings.filialNumbers === 'object' ? settings.filialNumbers : DEFAULT_SETTINGS.filialNumbers
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), 'utf8');
        logger.info('⚙️ Configurações salvas em settings.json');
        return true;
    } catch (err) {
        logger.error(`Erro ao salvar settings.json: ${err.message}`);
        return false;
    }
}

function getPollInterval() {
    return getSettings().pollIntervalMinutes;
}

function getNotifyNumbers() {
    return getSettings().notifyNumbers;
}

function getGroupNameForFilial(codFilial) {
    const settings = getSettings();
    return settings.filialGroups[String(codFilial)] || null;
}

function getConfiguredFiliais() {
    const settings = getSettings();
    return Object.entries(settings.filialGroups)
        .filter(([_, name]) => name && name.trim() !== '')
        .map(([cod, name]) => ({ codFilial: cod, groupName: name }));
}

function getFilialNumbers(codFilial) {
    const settings = getSettings();
    const numbersStr = settings.filialNumbers?.[String(codFilial)] || '';
    if (!numbersStr || numbersStr.trim() === '') return [];
    return numbersStr
        .split(/[\n,]+/)
        .map(n => n.trim().replace(/\D/g, ''))
        .filter(n => n.length >= 8); // BR phones have at least 8 digits
}

module.exports = {
    getSettings,
    saveSettings,
    getPollInterval,
    getNotifyNumbers,
    getGroupNameForFilial,
    getConfiguredFiliais,
    getFilialNumbers
};
