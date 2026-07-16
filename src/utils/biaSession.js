const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Estado de menu da BIA por telefone. Mesmo padrão do ai_chat_memory.
const SESSIONS_PATH = path.join(__dirname, '..', '..', 'data', 'bia_sessions.json');
const DEFAULT_MENU = 'root';
const TTL_MS = 2 * 60 * 60 * 1000; // sessão expira após 2h de inatividade

function loadAll() {
    try {
        if (fs.existsSync(SESSIONS_PATH)) {
            return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'));
        }
    } catch (e) { /* ignora parse inválido */ }
    return {};
}

function saveAll(data) {
    try {
        const dir = path.dirname(SESSIONS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`Erro ao salvar bia_sessions.json: ${e.message}`);
    }
}

/** Retorna o menu atual do telefone; 'root' se novo ou expirado. */
function getSession(phone) {
    const all = loadAll();
    const s = all[phone];
    if (!s || !s.updatedAt || Date.now() - new Date(s.updatedAt).getTime() > TTL_MS) {
        return { menu: DEFAULT_MENU, updatedAt: null };
    }
    return { menu: s.menu || DEFAULT_MENU, updatedAt: s.updatedAt };
}

/** Persiste o menu atual do telefone. */
function setSession(phone, menu) {
    const all = loadAll();
    all[phone] = { menu: menu || DEFAULT_MENU, updatedAt: new Date().toISOString() };
    saveAll(all);
    return all[phone];
}

module.exports = { getSession, setSession };
