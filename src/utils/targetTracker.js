const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SENT_TARGETS_FILE = path.join(__dirname, '..', '..', 'data', 'sent_targets.json');
let sentTargets = {};

// Carrega os destinatários notificados do disco
function load() {
    try {
        if (fs.existsSync(SENT_TARGETS_FILE)) {
            sentTargets = JSON.parse(fs.readFileSync(SENT_TARGETS_FILE, 'utf8'));
        } else {
            sentTargets = {};
        }
    } catch (e) {
        logger.error(`Erro ao carregar sent_targets.json: ${e.message}`);
        sentTargets = {};
    }
}

// Salva os destinatários notificados no disco
function save() {
    try {
        const dir = path.dirname(SENT_TARGETS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SENT_TARGETS_FILE, JSON.stringify(sentTargets, null, 2), 'utf8');
    } catch (e) {
        logger.error(`Erro ao salvar sent_targets.json: ${e.message}`);
    }
}

// Verifica se um item já foi enviado para um destinatário específico
function hasSent(key, target) {
    if (!sentTargets[key]) return false;
    return sentTargets[key].includes(target);
}

// Marca um item como enviado para um destinatário
function markSent(key, target) {
    if (!sentTargets[key]) {
        sentTargets[key] = [];
    }
    if (!sentTargets[key].includes(target)) {
        sentTargets[key].push(target);
    }
}

// Remove o registro de um item (chamado após ser completamente concluído e movido para processedKeys)
function clearKey(key) {
    if (sentTargets[key]) {
        delete sentTargets[key];
    }
}

// Verifica se um item (chave) foi enviado para todos os destinatários esperados da filial
function isKeyCompleted(key, codFilial) {
    const { NOTIFY_NUMBERS, getFilialNumbers } = require('../config/groups');

    const expected = [];

    // Grupos foram desativados para notificação de estoque: não são mais destinatários
    // esperados (a BIA não posta chegada de mercadoria em grupos). Só números individuais.

    for (const num of NOTIFY_NUMBERS) {
        expected.push(`number:${num}`);
    }
    
    const filialSellers = getFilialNumbers(codFilial);
    for (const num of filialSellers) {
        expected.push(`number:${num}`);
    }
    
    if (expected.length === 0) return true;
    
    const sentList = sentTargets[key] || [];
    return expected.every(target => sentList.includes(target));
}

// Inicializa no carregamento do módulo
load();

module.exports = {
    hasSent,
    markSent,
    clearKey,
    isKeyCompleted,
    save,
    load
};
