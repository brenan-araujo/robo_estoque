const { getConnection, oracledb } = require('../config/database');
const configManager = require('../utils/configManager');
const contactsManager = require('../utils/contactsManager');
const whatsapp = require('./whatsappService');
const sentTracker = require('../utils/sentTracker');
const logger = require('../utils/logger');
const { CronJob } = require('cron');
const fs = require('fs');
const path = require('path');

const NOTIFIED_FILE = path.join(__dirname, '..', '..', 'data', 'notified_personalized_products.json');

const REDIRECT_TO_BRENAN = true; // Por enquanto, envia apenas os exemplos no pessoal do Brenan
const BRENAN_PHONE = '5561983391951';

/**
 * Obtém o dia da semana em São Paulo (0 = Domingo, 1 = Segunda, etc.)
 */
function getSaoPauloDayOfWeek() {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'long' });
        const dayName = formatter.format(new Date());
        const days = {
            'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
            'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };
        return days[dayName];
    } catch (err) {
        return new Date().getDay();
    }
}

let cronJob = null;

/**
 * Lê o histórico de produtos personalizados já notificados
 */
function loadNotifiedMap() {
    try {
        if (fs.existsSync(NOTIFIED_FILE)) {
            const content = fs.readFileSync(NOTIFIED_FILE, 'utf8');
            return JSON.parse(content);
        }
    } catch (err) {
        logger.warn(`Erro ao ler notified_personalized_products.json: ${err.message}. Retornando objeto vazio.`);
    }
    return {};
}

/**
 * Grava o mapa de produtos notificados no arquivo
 */
function saveNotifiedMap(map) {
    try {
        const dir = path.dirname(NOTIFIED_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(NOTIFIED_FILE, JSON.stringify(map, null, 2), 'utf8');
    } catch (err) {
        logger.error(`Erro ao salvar notified_personalized_products.json: ${err.message}`);
    }
}

/**
 * Formata a mensagem consolidada para um vendedor ou administrador
 */
function formatConsolidatedMessage(vendedor, items, isTest = false, isAdminAlert = false, codrca = '') {
    let msg = `🔔 *${isTest ? '[TESTE] ' : ''}Produtos Personalizados em Estoque!*\n\n`;
    
    if (isAdminAlert) {
        msg += `⚠️ *Aviso de Vendedor Sem WhatsApp Cadastrado*\n`;
        msg += `Os produtos abaixo pertencem ao vendedor *${vendedor}* (RCA ${codrca}), mas ele não possui contato válido no sistema:\n\n`;
    } else {
        msg += `Olá *${vendedor}*,\n`;
        msg += `Aqui está o resumo dos produtos personalizados dos seus clientes atualmente disponíveis em estoque:\n\n`;
    }

    const newItems = items.filter(item => item.status === 'NOVO');
    const oldItems = items.filter(item => item.status === 'EM_ESTOQUE');

    if (newItems.length > 0) {
        msg += `📥 *[Chegou agora]*\n`;
        newItems.forEach((item, index) => {
            msg += `🔹 *Produto:* ${item.codprod} - ${item.descricao}\n`;
            msg += `👤 *Codcli:* ${item.codcli} - ${item.cliente}\n`;
            msg += `📦 *Estoque Disponível:* ${item.estoque} unidades\n`;
            if (index < newItems.length - 1) {
                msg += `───────────────────\n`;
            } else {
                msg += `\n`;
            }
        });
    }

    if (oldItems.length > 0) {
        msg += `⏳ *[Ainda no estoque]*\n`;
        oldItems.forEach((item, index) => {
            msg += `🔹 *Produto:* ${item.codprod} - ${item.descricao}\n`;
            msg += `👤 *Codcli:* ${item.codcli} - ${item.cliente}\n`;
            msg += `📦 *Estoque Disponível:* ${item.estoque} unidades\n`;
            if (index < oldItems.length - 1) {
                msg += `───────────────────\n`;
            } else {
                msg += `\n`;
            }
        });
    }

    msg += `⚠️ *Atenção:* Não deixe estes itens parados em estoque. \n\n`;

    if (isTest) {
        msg += `_Fim do relatório de demonstração de teste._`;
    }

    return msg.trim();
}

/**
 * Consulta e envia alertas de produtos personalizados
 * @param {boolean} dryRun - Se verdadeiro, apenas gera logs e não envia mensagens reais
 * @param {string|null} testPhone - Se informado, envia um modelo de exemplo para este número
 * @param {string|null} vendorFilter - Se informado, filtra pelo nome do vendedor (busca parcial, case-insensitive)
 */
async function sendPersonalizedProductsAlerts(dryRun = false, testPhone = null, vendorFilter = null) {
    logger.info(`🔍 Iniciando verificação de produtos personalizados (dryRun: ${dryRun}, testPhone: ${testPhone}, vendorFilter: ${vendorFilter})...`);
    
    let connection;
    try {
        connection = await getConnection();
        
        const sql = `
            WITH LastOrder AS (
              SELECT codprod, codcli, codusur, dtped
              FROM (
                SELECT i.codprod, c.codcli, c.codusur, c.data as dtped,
                       ROW_NUMBER() OVER (PARTITION BY i.codprod ORDER BY c.data DESC) as rn
                FROM pcpedi i
                JOIN pcpedc c ON c.numped = i.numped
                WHERE i.posicao IN ('P', 'B')
              ) WHERE rn = 1
            ),
            LastSale AS (
              SELECT codprod, max(codcli) as codcli
              FROM pcmov
              WHERE codoper = 'S'
              GROUP BY codprod
            )
            SELECT p.codprod, p.descricao,
                   (SELECT SUM(qtestger - qtbloqueada - qtreserv - qtindeniz) FROM pcest WHERE codprod = p.codprod) AS estoque,
                   COALESCE(lo.codcli, ls.codcli) AS codcli,
                   COALESCE(
                     (SELECT fantasia FROM pcclient WHERE codcli = COALESCE(lo.codcli, ls.codcli)),
                     'Cliente Não Identificado'
                   ) AS cliente,
                   COALESCE(
                     (SELECT codusur1 FROM pcclient WHERE codcli = COALESCE(lo.codcli, ls.codcli)),
                     lo.codusur
                   ) AS codrca,
                   COALESCE(
                     (SELECT nome FROM pcusuari WHERE codusur = COALESCE((SELECT codusur1 FROM pcclient WHERE codcli = COALESCE(lo.codcli, ls.codcli)), lo.codusur)),
                     'Vendedor Não Identificado'
                   ) AS vendedor
            FROM pcprodut p
            LEFT JOIN LastOrder lo ON lo.codprod = p.codprod
            LEFT JOIN LastSale ls ON ls.codprod = p.codprod
            WHERE p.dtexclusao IS NULL
              AND (
                -- Fornecedor DUPLAX - TRIPOLI
                (p.codfornec = 13025 AND p.codprod NOT IN (13310,13311,13298,16007,13299,13300,16059,15393,15694,14675,15693))
                OR
                -- Fornecedor PERSONALIZACAO (excluindo clichês de gravação)
                (p.codfornec = 12636 AND p.descricao NOT LIKE 'CLICHE%')
                OR
                -- Fornecedor PATOTI EMBALAGENS
                (p.codfornec = 14477)
              )
              AND (SELECT SUM(qtestger) FROM pcest WHERE codprod = p.codprod) > 0
        `;

        const result = await connection.execute(
            sql,
            {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const rows = result.rows || [];
        logger.info(`Encontrados ${rows.length} produtos personalizados ativos com estoque geral no banco Oracle.`);

        if (rows.length === 0) {
            return { success: true, sentCount: 0, skippedCount: 0, dryRun };
        }

        const notifiedMap = loadNotifiedMap();
        const contacts = contactsManager.getContacts();
        let sentCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        // Lista de CODPROD retornados para limpar itens antigos do mapa
        const activeCodProds = new Set();

        // 1. Agrupamento / Consolidação
        const rcaGroups = {};
        
        for (const row of rows) {
            const codprod = row.CODPROD;
            const descricao = row.DESCRICAO;
            const estoque = row.ESTOQUE || 0;
            const codcli = row.CODCLI;
            const cliente = row.CLIENTE;
            const codrca = row.CODRCA;
            const vendedor = row.VENDEDOR;

            activeCodProds.add(String(codprod));

            // Só notifica se tiver estoque disponível positivo (ou se for teste)
            if (estoque <= 0 && !testPhone) {
                skippedCount++;
                continue;
            }

            // Define o status (NOVO ou EM_ESTOQUE) comparando com a última quantidade notificada
            const lastNotifiedStock = notifiedMap[String(codprod)] || 0;
            const status = (estoque > lastNotifiedStock) ? 'NOVO' : 'EM_ESTOQUE';

            const rcaKey = codrca ? String(codrca).trim() : 'N/A';
            if (!rcaGroups[rcaKey]) {
                rcaGroups[rcaKey] = {
                    vendedor: vendedor || 'Vendedor Não Identificado',
                    codrca: rcaKey,
                    items: []
                };
            }
            rcaGroups[rcaKey].items.push({
                codprod,
                descricao,
                estoque,
                codcli,
                cliente,
                status
            });
        }

        // 2. Envio de Teste (Brenan)
        if (testPhone) {
            // Se foi passado vendorFilter, tenta encontrar o vendedor específico; senão usa o primeiro
            const firstActiveKey = Object.keys(rcaGroups).find(key => {
                const group = rcaGroups[key];
                if (group.items.length === 0) return false;
                if (vendorFilter) {
                    return group.vendedor.toLowerCase().includes(vendorFilter.toLowerCase());
                }
                return true;
            });
            if (!firstActiveKey) {
                logger.info('Nenhum item com estoque encontrado para teste.');
                return { success: true, sentCount: 0, skippedCount, errorCount, dryRun };
            }

            const group = rcaGroups[firstActiveKey];
            
            // Simula um item novo e um antigo para demonstração visual
            if (group.items.length > 1) {
                group.items[0].status = 'NOVO';
                group.items[1].status = 'EM_ESTOQUE';
            }

            const message = formatConsolidatedMessage(group.vendedor, group.items, true, false, group.codrca);

            if (dryRun) {
                logger.info(`[DRY-RUN] Enviando exemplo de teste consolidado de ${group.vendedor} para ${testPhone}:\n${message}`);
                sentCount++;
            } else {
                try {
                    if (whatsapp.isClientReady()) {
                        const sent = await whatsapp.sendToNumber(testPhone, message);
                        if (sent) {
                            sentTracker.trackSent('number', testPhone, message, group.items.length, { type: 'personalized_product_test' });
                            sentCount++;
                            logger.info(`Exemplo de teste consolidado de ${group.vendedor} enviado com sucesso para ${testPhone}.`);
                        } else {
                            throw new Error('Falha no envio da mensagem pelo WhatsApp');
                        }
                    } else {
                        throw new Error('WhatsApp Client não está pronto');
                    }
                } catch (sendErr) {
                    logger.error(`Erro ao enviar WhatsApp de teste de ${group.vendedor} para ${testPhone}: ${sendErr.message}`);
                    errorCount++;
                }
            }
            
            return { success: true, sentCount, skippedCount, errorCount, dryRun };
        }

        // 3. Envio de Produção Consolidada
        const adminNumbers = configManager.getPdfNotifyNumbers();
        const currentSpDay = getSaoPauloDayOfWeek();
        const isMondayOrThursday = (currentSpDay === 1 || currentSpDay === 4);

        for (const [rcaKey, group] of Object.entries(rcaGroups)) {
            if (group.items.length === 0) continue;

            const hasNewProduct = group.items.some(item => item.status === 'NOVO');

            // Regra de negócios: Se não há produtos novos, só envia na segunda e na quinta-feira de manhã.
            // Ignoramos essa restrição se for teste manual (testPhone especificado) ou se o redirecionamento estiver ativo,
            // para permitir a visualização completa de todos os exemplos de mensagens.
            if (!hasNewProduct && !isMondayOrThursday && !testPhone && !REDIRECT_TO_BRENAN) {
                logger.info(`[PRODUÇÃO] Pulando vendedor ${group.vendedor} (RCA ${rcaKey}) porque não possui produtos novos e hoje não é segunda nem quinta-feira.`);
                skippedCount += group.items.length;
                continue;
            }

            // Resolve contato do vendedor
            let targetPhone = '';
            const matchedContact = contacts.find(c => c.rcaCode === rcaKey && c.role === 'vendedor');

            if (matchedContact && matchedContact.phone) {
                targetPhone = matchedContact.phone;
            }

            // Redireciona para o Brenan se a flag estiver ativa
            const finalPhone = REDIRECT_TO_BRENAN ? BRENAN_PHONE : targetPhone;

            if (finalPhone) {
                const isRedirected = REDIRECT_TO_BRENAN && (targetPhone !== BRENAN_PHONE);
                // Se o vendedor não tem telefone e estamos mandando o exemplo, sinalizamos como alerta de admin (isAdminAlert = !targetPhone)
                const message = formatConsolidatedMessage(group.vendedor, group.items, false, !targetPhone, rcaKey);

                if (dryRun) {
                    logger.info(`[DRY-RUN] Enviando consolidado para ${group.vendedor} (Destinatário: ${finalPhone}):\n${message}`);
                    sentCount++;
                } else {
                    try {
                        if (whatsapp.isClientReady()) {
                            const sent = await whatsapp.sendToNumber(finalPhone, message);
                            if (sent) {
                                sentTracker.trackSent('number', finalPhone, message, group.items.length, { 
                                    type: isRedirected ? 'personalized_product_redirect' : 'personalized_product_consolidated', 
                                    codrca: rcaKey,
                                    originalPhone: targetPhone
                                });
                                sentCount++;
                                logger.info(`Mensagem consolidada de ${group.vendedor} enviada para ${finalPhone} (Original: ${targetPhone || 'N/A'}, Redirecionado: ${isRedirected}).`);
                            } else {
                                throw new Error('Falha no envio da mensagem pelo WhatsApp');
                            }
                        } else {
                            throw new Error('WhatsApp Client não está pronto');
                        }
                    } catch (sendErr) {
                        logger.error(`Erro ao enviar consolidado de ${group.vendedor} para ${finalPhone}: ${sendErr.message}`);
                        errorCount++;
                    }
                }

                // Se o redirecionamento estiver ativo, enviamos apenas o primeiro vendedor como exemplo no pessoal do Brenan e interrompemos!
                if (REDIRECT_TO_BRENAN) {
                    logger.info(`[REDIRECIONAMENTO] Enviado apenas o exemplo do primeiro vendedor (${group.vendedor}) para o Brenan. Parando loop.`);
                    break;
                }
            } else {
                // Caso não tenha telefone do vendedor e a flag REDIRECT_TO_BRENAN esteja inativa (futura produção)
                if (adminNumbers && adminNumbers.length > 0) {
                    const message = formatConsolidatedMessage(group.vendedor, group.items, false, true, rcaKey);
                    
                    if (dryRun) {
                        logger.info(`[DRY-RUN] Alerta de vendedor sem WhatsApp enviado para admins:\n${message}`);
                        sentCount++;
                    } else {
                        logger.warn(`Vendedor ${group.vendedor} (RCA ${rcaKey}) sem telefone. Enviando consolidado para admins.`);
                        let adminSentSuccess = false;
                        
                        for (const adminNum of adminNumbers) {
                            try {
                                if (whatsapp.isClientReady()) {
                                    const sent = await whatsapp.sendToNumber(adminNum, message);
                                    if (sent) {
                                        sentTracker.trackSent('number', adminNum, message, group.items.length, { type: 'personalized_product_admin_fallback', codrca: rcaKey });
                                        adminSentSuccess = true;
                                    }
                                }
                            } catch (aErr) {
                                logger.error(`Erro ao enviar alerta de fallback para admin ${adminNum}: ${aErr.message}`);
                            }
                        }
                        
                        if (adminSentSuccess) {
                            sentCount++;
                        } else {
                            errorCount++;
                        }
                    }
                } else {
                    logger.error(`Vendedor ${group.vendedor} (RCA ${rcaKey}) sem contato e nenhum admin configurado para fallback.`);
                    errorCount++;
                }
            }

            // Atualiza o estado das notificações no map para cada produto enviado neste grupo
            group.items.forEach(item => {
                notifiedMap[String(item.codprod)] = item.estoque;
            });
        }

        // Limpa chaves do mapa que não estão mais ativas no estoque geral (foram totalmente vendidas ou excluídas)
        Object.keys(notifiedMap).forEach(key => {
            if (!activeCodProds.has(key)) {
                logger.info(`Produto personalizado ${key} não está mais em estoque geral. Resetando estado de notificação.`);
                delete notifiedMap[key];
            }
        });

        // Salva mapa de notificações apenas se não for teste/redirecionamento
        if (!testPhone && !REDIRECT_TO_BRENAN) {
            saveNotifiedMap(notifiedMap);
        } else {
            logger.info(`[TESTE/REDIRECIONAMENTO] Ignorando salvamento do arquivo notified_personalized_products.json.`);
        }

        logger.info(`📊 Automação de produtos personalizados finalizada. Sucessos: ${sentCount}, Pulados: ${skippedCount}, Falhas: ${errorCount}`);
        return { success: true, sentCount, skippedCount, errorCount, dryRun };

    } catch (err) {
        logger.error(`Erro crítico na automação de produtos personalizados: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (cErr) {
                logger.error(`Erro ao fechar conexão com Oracle: ${cErr.message}`);
            }
        }
    }
}

/**
 * Inicializa o agendamento cron
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const cronTime = configManager.getPersonalizedProductsCronTime();
    logger.info(`⏰ Agendando rotina de alerta de produtos personalizados (cron: "${cronTime}")`);

    try {
        cronJob = CronJob.from({
            cronTime: cronTime,
            onTick: async () => {
                logger.info('⏰ Cron de Alerta de Produtos Personalizados ativado.');
                try {
                    if (whatsapp.isClientReady()) {
                        await sendPersonalizedProductsAlerts(false);
                    } else {
                        logger.warn('⚠️ WhatsApp não está pronto. Alerta de produtos personalizados pulado.');
                    }
                } catch (err) {
                    logger.error(`Erro ao executar rotina agendada de produtos personalizados: ${err.message}`);
                }
            },
            start: true,
            timeZone: "America/Sao_Paulo"
        });

        logger.info('🚀 Cron job de alerta de produtos personalizados inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de produtos personalizados: ${e.message}`);
    }
}

module.exports = {
    sendPersonalizedProductsAlerts,
    initScheduler
};
