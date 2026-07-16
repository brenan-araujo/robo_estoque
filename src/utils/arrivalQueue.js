const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Fila persistida de lotes de chegada de estoque aguardando o delay configurado
 * (arrivalDelayMinutes) entre o alerta de corte (prioridade do vendedor) e o
 * broadcast geral para a filial. Sobrevive a restarts: os lotes ficam em
 * data/pending_arrivals.json e são despachados quando dueAt vence.
 */
const QUEUE_FILE = path.join(__dirname, '..', '..', 'data', 'pending_arrivals.json');

let queue = [];

// Carrega a fila do disco na inicialização
try {
    if (fs.existsSync(QUEUE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
        if (Array.isArray(parsed)) queue = parsed;
    }
} catch (e) {
    logger.warn(`[FilaChegada] Erro ao carregar pending_arrivals.json: ${e.message}`);
}

function save() {
    try {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
    } catch (e) {
        logger.error(`[FilaChegada] Erro ao salvar pending_arrivals.json: ${e.message}`);
    }
}

/**
 * Enfileira um lote de entradas para broadcast após `delayMinutes`.
 * `cutsSummary` = { alerted, rcas } vindo do cutService (para exibição no painel).
 */
function enqueue(entries, delayMinutes, cutsSummary = null) {
    const now = Date.now();
    const batch = {
        id: `${now}-${Math.floor(Math.random() * 10000)}`,
        createdAt: new Date(now).toISOString(),
        dueAt: new Date(now + delayMinutes * 60000).toISOString(),
        cutsSummary,
        entries
    };
    queue.push(batch);
    save();
    logger.info(`[FilaChegada] Lote ${batch.id} enfileirado: ${entries.length} item(ns), broadcast às ${new Date(batch.dueAt).toLocaleTimeString('pt-BR')}.`);
    return batch;
}

/** Chaves (NUMTRANSENT-CODPROD) de tudo que está aguardando na fila. */
function getQueuedKeys() {
    const keys = new Set();
    for (const batch of queue) {
        for (const e of batch.entries) {
            keys.add(`${e.NUMTRANSENT}-${e.CODPROD}`);
        }
    }
    return keys;
}

/** Lotes cujo horário de disparo já venceu (ordenados do mais antigo pro mais novo). */
function getDueBatches(now = Date.now()) {
    return queue
        .filter(b => new Date(b.dueAt).getTime() <= now)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

/** Busca um lote pelo id (para o "Enviar agora" do painel). */
function getBatch(id) {
    return queue.find(b => b.id === id) || null;
}

function removeBatch(id) {
    const before = queue.length;
    queue = queue.filter(b => b.id !== id);
    if (queue.length !== before) save();
}

/** Visão resumida para o painel web. */
function listPending() {
    const now = Date.now();
    return queue.map(b => {
        const porFilial = {};
        for (const e of b.entries) {
            const f = String(e.CODFILIAL);
            porFilial[f] = (porFilial[f] || 0) + 1;
        }
        return {
            id: b.id,
            createdAt: b.createdAt,
            dueAt: b.dueAt,
            secondsRemaining: Math.max(0, Math.round((new Date(b.dueAt).getTime() - now) / 1000)),
            totalItems: b.entries.length,
            porFilial,
            cutsSummary: b.cutsSummary,
            produtos: b.entries.map(e => ({ codprod: e.CODPROD, descricao: e.DESCRICAO, filial: e.CODFILIAL, qt: e.QTDISP }))
        };
    }).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

module.exports = { enqueue, getQueuedKeys, getDueBatches, getBatch, removeBatch, listPending };
