const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let client = null;
let isReady = false;

// Cache de groupId por nome do grupo
const groupIdCache = {};

function isFatalPuppeteerError(err) {
    if (!err || !err.message) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('detached') || 
           msg.includes('protocol error') || 
           msg.includes('session closed') || 
           msg.includes('browser has disconnected') ||
           msg.includes('connection closed') ||
           msg.includes('detached frame');
}

function handleFatalError(err) {
    logger.error(`⚠️ Erro fatal do Puppeteer no WhatsApp client: ${err.message}`);
    isReady = false;
    if (client) {
        try {
            client.emit('disconnected', 'Fatal Puppeteer error: ' + err.message);
        } catch (e) {
            logger.error(`Erro ao emitir evento de desconexão: ${e.message}`);
        }
    }
}

/**
 * Inicializa o cliente do WhatsApp
 * Retorna uma Promise que resolve quando o cliente está pronto
 */
function initialize(callbacks = {}) {
    return new Promise((resolve, reject) => {
        const puppeteerOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu',
                '--no-zygote',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
            ],
        };

        // O Chrome gerenciado pelo puppeteer (ex.: 146.x) não inicia nesta máquina
        // (erro de configuração lado a lado / dependência de runtime ausente),
        // então usamos o Chrome do sistema mesmo — apesar do desalinhamento de
        // versão com o puppeteer, que causa quedas de protocolo ocasionais
        // (ex.: "Protocol error", "Execution context was destroyed").
        const systemChromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        if (fs.existsSync(systemChromePath)) {
            puppeteerOptions.executablePath = systemChromePath;
        }

        // Sem webVersionCache fixo: usa a versão atual do WhatsApp Web negociada ao vivo.
        // A versão alpha que estava fixada aqui passou a ser rejeitada pelo servidor em
        // NOVOS pareamentos (LOGOUT ~47s após escanear o QR), apesar de sessões já
        // pareadas continuarem funcionando com ela.
        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: puppeteerOptions,
        });

        let resolved = false;
        let timeoutAfterAuth = null;
        let hasReceivedQr = false;

        function resolveOnce() {
            if (!resolved) {
                resolved = true;
                if (timeoutAfterAuth) clearTimeout(timeoutAfterAuth);
                isReady = true;
                resolve();
            }
        }

        client.on('qr', (qr) => {
            hasReceivedQr = true;
            logger.info('📱 QR Code gerado! Escaneie com o WhatsApp:');
            console.log('');
            qrcode.generate(qr, { small: true });
            console.log('');
            logger.info('Abra o WhatsApp → Dispositivos Vinculados → Vincular Dispositivo');
            if (callbacks.onQr) callbacks.onQr(qr);
        });

        client.on('ready', () => {
            logger.info('✅ WhatsApp conectado e pronto!');
            if (callbacks.onReady) callbacks.onReady();
            resolveOnce();
        });

        // Às vezes o 'ready' não dispara mas o cliente já está funcional após autenticação.
        // Aguarda 30s após 'authenticated' e resolve mesmo assim.
        client.on('authenticated', () => {
            logger.info('🔑 WhatsApp autenticado com sucesso');
            if (callbacks.onAuthenticated) callbacks.onAuthenticated();
            timeoutAfterAuth = setTimeout(() => {
                if (!resolved) {
                    logger.warn('⚠️ Evento "ready" não disparou após 30s. Continuando mesmo assim...');
                    if (callbacks.onReady) {
                        try {
                            callbacks.onReady();
                        } catch (e) {
                            logger.error(`Erro ao disparar callback onReady no timeout: ${e.message}`);
                        }
                    }
                    resolveOnce();
                }
            }, 30000);
        });

        client.on('message', async (msg) => {
            try {
                if (msg.fromMe) return;
                if (msg.from.includes('@g.us')) return; // grupo
                if (msg.from === 'status@broadcast') return;
                if (msg.type !== 'chat') return; // apenas texto

                const contact = await msg.getContact();
                let resolvedPhone = contact.number || '';
                let phonePayload = msg.from;

                if (msg.from.endsWith('@lid') || (contact.id && contact.id.server === 'lid')) {
                    try {
                        const lidResult = await client.getContactLidAndPhone(msg.from);
                        if (lidResult && lidResult[0] && lidResult[0].pn) {
                            const pnUser = lidResult[0].pn.split('@')[0];
                            if (pnUser) {
                                resolvedPhone = pnUser;
                                phonePayload = pnUser; // Envia o telefone real para o n8n para manter a sessão unificada
                                logger.info(`[Bia] LID ${msg.from} resolvido para telefone real: ${resolvedPhone}`);
                            }
                        }
                    } catch (lidErr) {
                        logger.error(`[Bia] Erro ao tentar resolver LID para telefone: ${lidErr.message}`);
                    }
                }

                logger.info(`[Bia] Mensagem de ${msg.from} (Resolvido: ${resolvedPhone}): ${msg.body.substring(0, 60)}`);

                const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/bia-whatsapp';
                fetch(N8N_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: phonePayload,
                        resolvedPhone,
                        message: msg.body,
                        timestamp: new Date().toISOString(),
                        messageId: msg.id._serialized
                    })
                }).catch(err => {
                    logger.error(`[Bia] Erro ao chamar n8n: ${err.message}`);
                });
            } catch (err) {
                logger.error(`[Bia] Erro no listener: ${err.message}`);
            }
        });

        client.on('auth_failure', (msg) => {
            logger.error(`❌ Falha na autenticação WhatsApp: ${msg}`);
            if (callbacks.onAuthFailure) callbacks.onAuthFailure(msg);
            if (!resolved) {
                resolved = true;
                reject(new Error(`Auth failure: ${msg}`));
            }
        });

        client.on('disconnected', (reason) => {
            isReady = false;
            logger.warn(`⚠️ WhatsApp desconectado: ${reason}`);
            if (callbacks.onDisconnected) callbacks.onDisconnected(reason);
        });

        // Timeout geral: se nada acontecer em 3min, rejeita
        setTimeout(() => {
            if (!resolved) {
                if (hasReceivedQr) {
                    logger.info('ℹ️ WhatsApp aguardando escaneamento do QR Code pelo usuário.');
                    return;
                }
                resolved = true;
                reject(new Error('Timeout: WhatsApp não inicializou em 3 minutos'));
            }
        }, 180000);

        logger.info('🔄 Inicializando WhatsApp... (aguarde o QR code)');
        client.initialize().catch((err) => {
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });
    });
}

/**
 * Busca o ID de um grupo pelo nome
 * Usa cache para evitar buscas repetidas
 * 
 * @param {string} groupName - Nome exato do grupo
 * @returns {string|null} ID do grupo ou null se não encontrado
 */
async function getGroupId(groupName) {
    if (!isReady) {
        logger.warn('WhatsApp não está pronto');
        return null;
    }

    // Verifica cache
    if (groupIdCache[groupName]) {
        return groupIdCache[groupName];
    }

    try {
        const chats = await client.getChats();
        const group = chats.find(
            chat => chat.isGroup && chat.name.trim().toLowerCase() === groupName.trim().toLowerCase()
        );

        if (group) {
            groupIdCache[groupName] = group.id._serialized;
            logger.debug(`Grupo encontrado: "${groupName}" → ${group.id._serialized}`);
            return group.id._serialized;
        } else {
            logger.warn(`⚠️ Grupo "${groupName}" não encontrado no WhatsApp`);
            return null;
        }
    } catch (err) {
        logger.error(`Erro ao buscar grupo "${groupName}": ${err.message}`);
        return null;
    }
}

/**
 * Envia mensagem para um grupo pelo nome
 * 
 * @param {string} groupName - Nome do grupo
 * @param {string} message - Mensagem a enviar
 * @returns {boolean} true se enviou com sucesso
 */
async function sendToGroup(groupName, message, itemCount = 0, details = {}) {
    if (!isReady) {
        logger.warn('WhatsApp não está pronto. Mensagem não enviada.');
        return false;
    }

    try {
        const groupId = await getGroupId(groupName);
        if (!groupId) {
            logger.warn(`Grupo "${groupName}" não encontrado. Mensagem descartada.`);
            return false;
        }

        await client.sendMessage(groupId, message);
        logger.info(`📩 Mensagem enviada para grupo "${groupName}"`);
        
        try {
            const { trackSent } = require('../utils/sentTracker');
            trackSent('group', groupName, message, itemCount, details);
        } catch (e) {
            logger.error(`Erro ao registrar histórico de envio para grupo: ${e.message}`);
        }
        
        return true;

    } catch (err) {
        logger.error(`Erro ao enviar para "${groupName}": ${err.message}`);
        if (isFatalPuppeteerError(err)) {
            handleFatalError(err);
        }
        return false;
    }
}

/**
 * Envia mensagem para um número de telefone
 * Tenta validar o número com getNumberId antes de enviar.
 * Se falhar, tenta com/sem o 9° dígito (números BR).
 * 
 * @param {string} phoneNumber - Número no formato 5561983391951 (sem +)
 * @param {string} message - Mensagem a enviar
 * @returns {boolean} true se enviou com sucesso
 */
async function sendToNumber(phoneNumber, message, itemCount = 0, details = {}) {
    if (!isReady) {
        logger.warn('WhatsApp não está pronto. Mensagem não enviada.');
        return false;
    }

    // Se for um JID completo (ex: contendo @c.us ou @lid), envia diretamente
    if (String(phoneNumber).includes('@')) {
        try {
            await client.sendMessage(phoneNumber, message);
            logger.info(`📩 Mensagem enviada para JID ${phoneNumber}`);
            try {
                const { trackSent } = require('../utils/sentTracker');
                trackSent('number', phoneNumber, message, itemCount, details);
            } catch (e) {}
            return true;
        } catch (err) {
            logger.error(`Erro ao enviar para JID "${phoneNumber}": ${err.message}`);
            if (isFatalPuppeteerError(err)) {
                handleFatalError(err);
            }
            return false;
        }
    }

    // Lista de variações do número para tentar (BR: com e sem 9° dígito)
    const variations = [phoneNumber];
    
    // Se tem 13 dígitos (55 + 2 DDD + 9 + 8 número), tenta sem o 9
    if (phoneNumber.length === 13 && phoneNumber.startsWith('55')) {
        const without9 = phoneNumber.slice(0, 4) + phoneNumber.slice(5);
        variations.push(without9);
    }
    // Se tem 12 dígitos, tenta com o 9
    if (phoneNumber.length === 12 && phoneNumber.startsWith('55')) {
        const with9 = phoneNumber.slice(0, 4) + '9' + phoneNumber.slice(4);
        variations.push(with9);
    }

    for (const num of variations) {
        try {
            // Tenta validar o número no WhatsApp
            const numberId = await client.getNumberId(num);
            if (numberId) {
                await client.sendMessage(numberId._serialized, message);
                logger.info(`📩 Mensagem enviada para número ${num}`);
                
                try {
                    const { trackSent } = require('../utils/sentTracker');
                    trackSent('number', num, message, itemCount, details);
                } catch (e) {
                    logger.error(`Erro ao registrar histórico de envio: ${e.message}`);
                }
                
                return true;
            }
        } catch (err) {
            logger.debug(`Tentativa com ${num} falhou: ${err.message}`);
            if (isFatalPuppeteerError(err)) {
                handleFatalError(err);
                return false;
            }
        }
    }

    // Fallback: tenta enviar direto com @c.us
    try {
        const chatId = `${phoneNumber}@c.us`;
        await client.sendMessage(chatId, message);
        logger.info(`📩 Mensagem enviada para número ${phoneNumber} (fallback)`);
        
        try {
            const { trackSent } = require('../utils/sentTracker');
            trackSent('number', phoneNumber, message, itemCount, details);
        } catch (e) {
            logger.error(`Erro ao registrar histórico de envio fallback: ${e.message}`);
        }
        
        return true;
    } catch (err) {
        logger.error(`Erro ao enviar para ${phoneNumber}: ${err.message}`);
        if (isFatalPuppeteerError(err)) {
            handleFatalError(err);
        }
        return false;
    }
}

/**
 * Envia um arquivo PDF para um número de telefone
 */
async function sendFileToNumber(phoneNumber, filePath, caption = '', details = {}) {
    if (!isReady) {
        logger.warn('WhatsApp não está pronto. Arquivo não enviado.');
        return false;
    }
    
    if (!fs.existsSync(filePath)) {
        logger.error(`Arquivo não encontrado para envio: ${filePath}`);
        return false;
    }

    try {
        const media = MessageMedia.fromFilePath(filePath);
        
        // Lista de variações do número para tentar (BR: com e sem 9° dígito)
        const variations = [phoneNumber];
        
        // Se tem 13 dígitos (55 + 2 DDD + 9 + 8 número), tenta sem o 9
        if (phoneNumber.length === 13 && phoneNumber.startsWith('55')) {
            const without9 = phoneNumber.slice(0, 4) + phoneNumber.slice(5);
            variations.push(without9);
        }
        // Se tem 12 dígitos, tenta com o 9
        if (phoneNumber.length === 12 && phoneNumber.startsWith('55')) {
            const with9 = phoneNumber.slice(0, 4) + '9' + phoneNumber.slice(4);
            variations.push(with9);
        }

        for (const num of variations) {
            try {
                const numberId = await client.getNumberId(num);
                if (numberId) {
                    await client.sendMessage(numberId._serialized, media, { caption });
                    logger.info(`✅ Arquivo enviado para número ${num}`);
                    
                    try {
                        const { trackSent } = require('../utils/sentTracker');
                        trackSent('file', num, caption || `PDF: ${path.basename(filePath)}`, 0, details);
                    } catch (e) {
                        logger.error(`Erro ao registrar histórico de envio de arquivo: ${e.message}`);
                    }
                    
                    return true;
                }
            } catch (err) {
                logger.debug(`Tentativa de envio de arquivo para ${num} falhou: ${err.message}`);
                if (isFatalPuppeteerError(err)) {
                    handleFatalError(err);
                    return false;
                }
            }
        }

        // Fallback: tenta enviar direto com @c.us
        const chatId = `${phoneNumber}@c.us`;
        await client.sendMessage(chatId, media, { caption });
        logger.info(`✅ Arquivo enviado para número ${phoneNumber} (fallback)`);
        
        try {
            const { trackSent } = require('../utils/sentTracker');
            trackSent('file', phoneNumber, caption || `PDF: ${path.basename(filePath)}`, 0, details);
        } catch (e) {
            logger.error(`Erro ao registrar histórico de envio de arquivo fallback: ${e.message}`);
        }
        
        return true;

    } catch (err) {
        logger.error(`Erro ao enviar arquivo para ${phoneNumber}: ${err.message}`);
        if (isFatalPuppeteerError(err)) {
            handleFatalError(err);
        }
        return false;
    }
}

/**
 * Envia um arquivo (imagem/documento) para um grupo pelo nome
 * 
 * @param {string} groupName - Nome do grupo
 * @param {string} filePath - Caminho do arquivo
 * @param {string} caption - Legenda da mensagem
 * @returns {boolean} true se enviou com sucesso
 */
async function sendFileToGroup(groupName, filePath, caption = '', details = {}) {
    if (!isReady) {
        logger.warn('WhatsApp não está pronto. Arquivo não enviado.');
        return false;
    }
    
    if (!fs.existsSync(filePath)) {
        logger.error(`Arquivo não encontrado para envio no grupo: ${filePath}`);
        return false;
    }

    try {
        const groupId = await getGroupId(groupName);
        if (!groupId) {
            logger.warn(`Grupo "${groupName}" não encontrado. Arquivo descartado.`);
            return false;
        }

        const media = MessageMedia.fromFilePath(filePath);
        await client.sendMessage(groupId, media, { caption });
        logger.info(`✅ Arquivo enviado para o grupo "${groupName}"`);
        
        try {
            const { trackSent } = require('../utils/sentTracker');
            trackSent('group_file', groupName, caption || `PDF/Imagem: ${path.basename(filePath)}`, 0, details);
        } catch (e) {
            logger.error(`Erro ao registrar histórico de envio de arquivo para grupo: ${e.message}`);
        }
        
        return true;

    } catch (err) {
        logger.error(`Erro ao enviar arquivo para grupo "${groupName}": ${err.message}`);
        if (isFatalPuppeteerError(err)) {
            handleFatalError(err);
        }
        return false;
    }
}

/**
 * Lista todos os grupos do WhatsApp
 * Útil para mapear filiais → grupos
 */
async function listAllGroups() {
    if (!isReady) {
        logger.warn('WhatsApp não está pronto');
        return [];
    }

    try {
        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(chat => ({
                name: chat.name,
                id: chat.id._serialized,
                participants: chat.groupMetadata?.participants?.length || '?',
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return groups;
    } catch (err) {
        logger.error(`Erro ao listar grupos: ${err.message}`);
        return [];
    }
}

/**
 * Verifica se o WhatsApp está pronto
 */
function isClientReady() {
    return isReady;
}

/**
 * Encerra o cliente WhatsApp
 */
async function destroy() {
    isReady = false;
    if (client) {
        try {
            logger.info('Limpando ouvintes e encerrando cliente WhatsApp...');
            client.removeAllListeners();
            await client.destroy();
            logger.info('WhatsApp encerrado com sucesso');
        } catch (err) {
            logger.error(`Erro ao encerrar WhatsApp: ${err.message}`);
        } finally {
            client = null;
        }
    }
}

/**
 * Desconecta e limpa a sessão do WhatsApp
 */
async function logout() {
    if (client) {
        try {
            logger.info('Solicitando logout do cliente WhatsApp...');
            await client.logout();
            isReady = false;
            logger.info('Logout do cliente WhatsApp concluído com sucesso');
        } catch (err) {
            logger.error(`Erro ao fazer logout via client.logout(): ${err.message}`);
            try {
                await client.destroy();
            } catch (e) {}
            isReady = false;
            
            // Fallback manual para remover a pasta de sessão
            const authPath = path.resolve(process.cwd(), '.wwebjs_auth');
            if (fs.existsSync(authPath)) {
                logger.info(`Removendo diretório de sessão manual: ${authPath}`);
                fs.rmSync(authPath, { recursive: true, force: true });
            }
        }
    } else {
        const authPath = path.resolve(process.cwd(), '.wwebjs_auth');
        if (fs.existsSync(authPath)) {
            logger.info(`Removendo diretório de sessão (sem cliente ativo): ${authPath}`);
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    }
}

/** Retorna a instância do client (necessário para registrar listeners externos) */
function getClient() { return client; }

module.exports = { initialize, sendToGroup, sendToNumber, sendFileToNumber, sendFileToGroup, listAllGroups, isClientReady, getClient, destroy, logout };

