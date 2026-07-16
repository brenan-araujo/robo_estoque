const fs = require('fs');
const path = require('path');
const { getNewEntries, groupByFilial, formatMessage } = require('../services/oracleService');
const whatsapp = require('../services/whatsappService');
const { getGroupNameForFilial, NOTIFY_NUMBERS, getFilialNumbers } = require('../config/groups');
const { getLastUnlockDate, saveLastUnlockDate } = require('../utils/stateManager');
const logger = require('../utils/logger');
const targetTracker = require('../utils/targetTracker');
const cutService = require('../services/cutService');
const arrivalQueue = require('../utils/arrivalQueue');
const configManager = require('../utils/configManager');

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
 * FASE 2 — Broadcast geral de chegada para as filiais (admins + vendedores).
 * Contém a lógica original de envio e de avanço do ponteiro DTDESBLOQUEIO.
 */
async function broadcastArrivals(entries) {
    // 3. Agrupa por filial
    const grouped = groupByFilial(entries);

    // 4. Envia mensagem para cada filial
    const sentSuccessByFilial = {};

    for (const [codFilial, data] of Object.entries(grouped)) {
        // Monta a mensagem
        const message = formatMessage(codFilial, data);
        let filialSuccess = true;

        // 4a. [DESATIVADO] Notificação de chegada de estoque em GRUPOS foi removida a pedido.
        //     A BIA não posta mais entrada de mercadoria em grupos — apenas nos números
        //     individuais (admins + vendedores) abaixo. O rastreador (targetTracker) também
        //     deixou de exigir o grupo, para o ponteiro poder avançar normalmente.

        // 4b. Envia para números pessoais (sempre)
        if (NOTIFY_NUMBERS.length > 0) {
            for (const number of NOTIFY_NUMBERS) {
                const adminTarget = `number:${number}`;
                const adminAlreadySent = data.items.every(item => {
                    const key = `${item.numTransEnt}-${item.codProd}`;
                    return targetTracker.hasSent(key, adminTarget);
                });

                if (adminAlreadySent) {
                    logger.info(`Número: Admin ${number} já recebeu esta notificação da Filial ${codFilial}. Pulando...`);
                    continue;
                }

                if (whatsapp.isClientReady()) {
                    const sent = await whatsapp.sendToNumber(number, message, data.items.length, { codFilial });
                    if (sent) {
                        logger.info(`✅ Número: Filial ${codFilial} → ${number} (${data.items.length} produtos)`);
                        for (const item of data.items) {
                            const key = `${item.numTransEnt}-${item.codProd}`;
                            targetTracker.markSent(key, adminTarget);
                        }
                        targetTracker.save();
                    } else {
                        if (!whatsapp.isClientReady()) {
                            filialSuccess = false;
                            logger.error(`❌ Falha ao enviar para ${number} devido a erro no cliente WhatsApp`);
                        } else {
                            logger.warn(`⚠️ Falha ao enviar para número ${number} (possivelmente número inválido ou não registrado). Registrando de qualquer forma.`);
                            for (const item of data.items) {
                                const key = `${item.numTransEnt}-${item.codProd}`;
                                targetTracker.markSent(key, adminTarget);
                            }
                            targetTracker.save();
                        }
                    }
                } else {
                    filialSuccess = false;
                    logger.warn(`⚠️ WhatsApp não está pronto para enviar para número ${number}`);
                }
                await sleep(1500);
            }
        }

        // 4c. Envia para números dos vendedores da filial (com atrasos aleatórios espaçados de 20s a 60s)
        const filialSellers = getFilialNumbers(codFilial);
        if (filialSellers.length > 0) {
            logger.info(`Fila: Iniciando envio lento para ${filialSellers.length} vendedor(es) da Filial ${codFilial}...`);
            for (const sellerNumber of filialSellers) {
                const sellerTarget = `number:${sellerNumber}`;
                const sellerAlreadySent = data.items.every(item => {
                    const key = `${item.numTransEnt}-${item.codProd}`;
                    return targetTracker.hasSent(key, sellerTarget);
                });

                if (sellerAlreadySent) {
                    logger.info(`Fila: Vendedor ${sellerNumber} da Filial ${codFilial} já recebeu esta notificação. Pulando...`);
                    continue;
                }

                if (whatsapp.isClientReady()) {
                    // Gera delay aleatório de envio para humanizar (entre 20 e 60 segundos)
                    const randomDelay = Math.floor(Math.random() * (60000 - 20000 + 1)) + 20000;
                    logger.info(`Fila: Aguardando ${Math.round(randomDelay/1000)}s antes de notificar vendedor ${sellerNumber} da Filial ${codFilial}...`);
                    await sleep(randomDelay);

                    const sent = await whatsapp.sendToNumber(sellerNumber, message, data.items.length, { codFilial });
                    if (sent) {
                        logger.info(`✅ Vendedor: Filial ${codFilial} → ${sellerNumber} (${data.items.length} produtos)`);
                        for (const item of data.items) {
                            const key = `${item.numTransEnt}-${item.codProd}`;
                            targetTracker.markSent(key, sellerTarget);
                        }
                        targetTracker.save();
                    } else {
                        if (!whatsapp.isClientReady()) {
                            filialSuccess = false;
                            logger.error(`❌ Falha ao enviar para vendedor ${sellerNumber} devido a erro no cliente WhatsApp`);
                        } else {
                            logger.warn(`⚠️ Falha ao enviar para vendedor ${sellerNumber} (possivelmente número inválido ou não registrado). Registrando de qualquer forma.`);
                            for (const item of data.items) {
                                const key = `${item.numTransEnt}-${item.codProd}`;
                                targetTracker.markSent(key, sellerTarget);
                            }
                            targetTracker.save();
                        }
                    }
                } else {
                    filialSuccess = false;
                    logger.warn(`⚠️ WhatsApp não está pronto para enviar para vendedor ${sellerNumber}`);
                    break; // Se o cliente de rede desconectou, encerra fila
                }
            }
        }

        sentSuccessByFilial[codFilial] = filialSuccess;
    }

    // 5. Calcula a maior data de desbloqueio segura para salvar
    // Ordena por DTDESBLOQUEIO crescente
    const sortedEntries = [...entries].sort((a, b) => new Date(a.DTDESBLOQUEIO) - new Date(b.DTDESBLOQUEIO));

    const lastUnlockDate = getLastUnlockDate();
    let newLastUnlockDate = lastUnlockDate;
    for (const entry of sortedEntries) {
        const filial = String(entry.CODFILIAL);
        const key = `${entry.NUMTRANSENT}-${entry.CODPROD}`;

        // Verifica se a chave foi completamente enviada para todos os destinatários esperados
        if (targetTracker.isKeyCompleted(key, filial)) {
            newLastUnlockDate = entry.DTDESBLOQUEIO;
            // Registra como processado definitivamente
            processedKeys.add(key);
            // Limpa o registro temporário dos destinatários
            targetTracker.clearKey(key);
        } else {
            logger.warn(`⚠️ Parando avanço do ponteiro DTDESBLOQUEIO em ${newLastUnlockDate} devido a envio incompleto do item ${entry.CODPROD} (Filial ${filial}, Trans: ${entry.NUMTRANSENT})`);
            break;
        }
    }
    targetTracker.save();

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
}

/**
 * Despacha os lotes da fila cujo horário venceu. Assume que o lock (isRunning)
 * já está com o chamador.
 */
async function dispatchDueBatches() {
    const due = arrivalQueue.getDueBatches();
    let dispatched = 0;
    for (const batch of due) {
        logger.info(`[FilaChegada] ⏰ Delay vencido — despachando lote ${batch.id} (${batch.entries.length} itens)...`);
        await broadcastArrivals(batch.entries);
        // Remove só após concluir: se der exceção no meio, o lote permanece e é
        // retentado no próximo ciclo (o targetTracker impede envios duplicados).
        arrivalQueue.removeBatch(batch.id);
        dispatched++;
    }
    return dispatched;
}

/**
 * Job principal: verifica novos desbloqueios.
 * FASE 1 (imediata): alerta de corte/falta/rejeição direto pro vendedor do pedido.
 * FASE 2 (após arrivalDelayMinutes): broadcast geral de chegada pra filial.
 */
async function checkNewProducts() {
    // Evita execuções sobrepostas
    if (isRunning) {
        logger.debug('Job anterior ainda em execução, pulando...');
        return;
    }

    isRunning = true;

    try {
        // 0. Antes de buscar novidades, despacha lotes de chegada cujo delay venceu
        try {
            await dispatchDueBatches();
        } catch (e) {
            logger.error(`[FilaChegada] Erro ao despachar lotes vencidos: ${e.message}`);
        }

        // 1. Pega a data do último desbloqueio processado
        const lastUnlockDate = getLastUnlockDate();
        logger.debug(`Verificando desbloqueios com DTDESBLOQUEIO >= ${lastUnlockDate}`);

        // 2. Busca novas entradas no Oracle
        const rawEntries = await getNewEntries(lastUnlockDate);

        // Filtra chaves duplicadas (já processadas OU já aguardando na fila de delay)
        const queuedKeys = arrivalQueue.getQueuedKeys();
        const entries = rawEntries.filter(entry => {
            const key = `${entry.NUMTRANSENT}-${entry.CODPROD}`;
            return !processedKeys.has(key) && !queuedKeys.has(key);
        });

        if (entries.length === 0) {
            logger.debug('Nenhum novo desbloqueio encontrado');
            return;
        }

        logger.info(`🆕 ${entries.length} novo(s) desbloqueio(s) encontrado(s)!`);

        // FASE 1 — Cortes/faltas/rejeições: avisa os vendedores dos pedidos NA HORA
        let cutsSummary = null;
        try {
            cutsSummary = await cutService.checkAndNotifyCuts(entries);
            if (cutsSummary && cutsSummary.alerted > 0) {
                logger.info(`[Cortes] ✂️ ${cutsSummary.alerted} vendedor(es) avisado(s) com prioridade (${cutsSummary.matched} corte(s) resolvidos).`);
            }
        } catch (e) {
            logger.error(`Erro ao processar notificações de cortes: ${e.message}`);
        }

        // FASE 2 — Broadcast geral: imediato (delay 0) ou enfileirado para depois
        const delayMin = Number(configManager.getSettings().arrivalDelayMinutes) || 0;
        if (delayMin <= 0) {
            await broadcastArrivals(entries);
        } else {
            arrivalQueue.enqueue(entries, delayMin, cutsSummary ? {
                alerted: cutsSummary.alerted,
                matched: cutsSummary.matched,
                rcas: (cutsSummary.rcas || []).map(r => r.nome || r.rca)
            } : null);
            logger.info(`📤 Broadcast de chegada agendado para daqui a ${delayMin} min (prioridade dos cortes preservada).`);
        }

    } catch (err) {
        logger.error(`❌ Erro no job: ${err.message}`);
    } finally {
        isRunning = false;
    }
}

/**
 * Dispatcher independente: garante que os lotes saiam no horário mesmo que o
 * intervalo de verificação (pollInterval) seja maior que o delay configurado.
 */
async function processArrivalQueue() {
    if (isRunning) return { dispatched: 0, skipped: true };
    isRunning = true;
    try {
        const dispatched = await dispatchDueBatches();
        return { dispatched };
    } finally {
        isRunning = false;
    }
}

/**
 * "Enviar agora" do painel: dispara um lote específico antes do horário.
 */
async function dispatchBatchNow(batchId) {
    const batch = arrivalQueue.getBatch(batchId);
    if (!batch) return { success: false, message: 'Lote não encontrado (pode já ter sido enviado).' };
    if (isRunning) return { success: false, message: 'Job em execução no momento. Tente novamente em instantes.' };
    isRunning = true;
    try {
        logger.info(`[FilaChegada] 🚀 Disparo manual do lote ${batchId} solicitado pelo painel.`);
        await broadcastArrivals(batch.entries);
        arrivalQueue.removeBatch(batchId);
        return { success: true, message: `Lote ${batchId} enviado.` };
    } finally {
        isRunning = false;
    }
}

// Dispatcher em segundo plano (a cada 60s) — mantém o horário do delay preciso
// e sobrevive a restarts (a fila é persistida em disco).
setInterval(() => {
    processArrivalQueue().catch(e => logger.error(`[FilaChegada] Erro no dispatcher: ${e.message}`));
}, 60000);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { checkNewProducts, processArrivalQueue, dispatchBatchNow };
