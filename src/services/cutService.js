const { getConnection, oracledb } = require('../config/database');
const whatsapp = require('./whatsappService');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const contactsManager = require('../utils/contactsManager');
const configManager = require('../utils/configManager');

const PROCESSED_CUTS_FILE = path.join(__dirname, '..', '..', 'data', 'processed_cuts.json');
let processedCuts = new Set();

// Carrega as chaves de cortes já notificados do disco
try {
    const dir = path.dirname(PROCESSED_CUTS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(PROCESSED_CUTS_FILE)) {
        processedCuts = new Set(JSON.parse(fs.readFileSync(PROCESSED_CUTS_FILE, 'utf8')));
    }
} catch (e) {
    logger.warn(`Erro ao carregar processed_cuts.json: ${e.message}`);
}

function saveProcessedCuts() {
    try {
        fs.writeFileSync(PROCESSED_CUTS_FILE, JSON.stringify([...processedCuts]), 'utf8');
    } catch (e) {
        logger.error(`Erro ao salvar processed_cuts.json: ${e.message}`);
    }
}

/**
 * Busca cortes, faltas e rejeitos pendentes para um produto e filial específicos.
 * Aceita uma conexão compartilhada (sharedConn) para não abrir uma conexão por
 * produto quando chamada em lote; a janela de dias vem das configurações.
 */
async function getPendingCuts(codProd, codFilial, sharedConn = null) {
    let connection;
    const ownConnection = !sharedConn;
    const windowDays = Number(configManager.getSettings().cutWindowDays) || 15;
    try {
        connection = sharedConn || await getConnection();

        const isCombined = ['20', '6'].includes(String(codFilial));
        
        // Query unificada buscando em PCCORTEI, PCFALTA e PCPEDCFV + PCPEDIFV
        const sql = `
            WITH PENDENCIAS AS (
                -- 1. Cortes (PCCORTEI)
                SELECT 
                    C.DATA,
                    C.NUMPED,
                    TO_NUMBER(C.CODFILIAL) AS CODFILIAL,
                    C.CODUSUR AS RCA,
                    C.CODCLI,
                    CLI.CLIENTE,
                    C.CODPROD,
                    P.DESCRICAO,
                    C.QTFALTA AS QT_FALTA,
                    C.PVENDA,
                    'CORTE' AS TIPO
                FROM PCCORTEI C
                INNER JOIN PCPRODUT P ON P.CODPROD = C.CODPROD
                INNER JOIN PCCLIENT CLI ON CLI.CODCLI = C.CODCLI
                WHERE C.CODPROD = :codProd
                  AND C.QTFALTA > 0
                  AND C.DATA >= TRUNC(SYSDATE) - ${windowDays}
                  AND ${isCombined ? "C.CODFILIAL IN ('20', '6')" : "C.CODFILIAL = :codFilial"}
                
                UNION ALL
                
                -- 2. Faltas (PCFALTA)
                SELECT 
                    F.DATA,
                    F.NUMPED,
                    TO_NUMBER(F.CODFILIAL) AS CODFILIAL,
                    F.CODUSUR AS RCA,
                    F.CODCLI,
                    CLI.CLIENTE,
                    F.CODPROD,
                    P.DESCRICAO,
                    F.QT AS QT_FALTA,
                    F.PVENDA,
                    'FALTA' AS TIPO
                FROM PCFALTA F
                INNER JOIN PCPRODUT P ON P.CODPROD = F.CODPROD
                INNER JOIN PCCLIENT CLI ON CLI.CODCLI = F.CODCLI
                WHERE F.CODPROD = :codProd
                  AND F.QT > 0
                  AND F.DATA >= TRUNC(SYSDATE) - ${windowDays}
                  AND ${isCombined ? "F.CODFILIAL IN ('20', '6')" : "F.CODFILIAL = :codFilial"}
                
                UNION ALL
                
                -- 3. Rejeitos (PCPEDCFV + PCPEDIFV)
                SELECT 
                    PC.DTINCLUSAO AS DATA,
                    PI.NUMPEDRCA AS NUMPED,
                    TO_NUMBER(NVL(PC.CODFILIAL, PI.CODFILIALRETIRA)) AS CODFILIAL,
                    PI.CODUSUR AS RCA,
                    PC.CODCLI,
                    CLI.CLIENTE,
                    PI.CODPROD,
                    P.DESCRICAO,
                    PI.QT AS QT_FALTA,
                    PI.PVENDA,
                    'REJEICAO' AS TIPO
                FROM PCPEDIFV PI
                INNER JOIN PCPEDCFV PC ON PC.NUMPEDRCA = PI.NUMPEDRCA AND PC.CODUSUR = PI.CODUSUR
                INNER JOIN PCPRODUT P ON P.CODPROD = PI.CODPROD
                INNER JOIN PCCLIENT CLI ON CLI.CODCLI = PC.CODCLI
                WHERE PI.CODPROD = :codProd
                  AND PC.POSICAO_ATUAL = 'R'
                  AND PI.QT > 0
                  AND PC.DTINCLUSAO >= TRUNC(SYSDATE) - ${windowDays}
                  AND ${isCombined ? "NVL(PC.CODFILIAL, PI.CODFILIALRETIRA) IN ('20', '6')" : "NVL(PC.CODFILIAL, PI.CODFILIALRETIRA) = :codFilial"}
            )
            SELECT 
                P.DATA,
                P.NUMPED,
                P.CODFILIAL,
                P.RCA,
                U.NOME AS NOME_RCA,
                P.CODCLI,
                P.CLIENTE,
                P.CODPROD,
                P.DESCRICAO,
                P.QT_FALTA,
                P.PVENDA,
                NVL(P.QT_FALTA * P.PVENDA, 0) AS VALOR_TOTAL,
                P.TIPO
            FROM PENDENCIAS P
            LEFT JOIN PCUSUARI U ON U.CODUSUR = P.RCA
            ORDER BY P.DATA ASC
        `;

        const bindParams = isCombined ? { codProd } : { codProd, codFilial };
        const result = await connection.execute(
            sql, 
            bindParams, 
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        return result.rows;
    } catch (err) {
        logger.error(`Erro ao buscar cortes para produto ${codProd} (Filial ${codFilial}): ${err.message}`);
        return [];
    } finally {
        // Só fecha a conexão se foi aberta aqui (não fecha a compartilhada do lote)
        if (connection && ownConnection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Verifica novos desbloqueios contra a tabela de cortes e notifica se o estoque for suficiente
 * 
 * @param {Array} entries - Lista de novos desbloqueios
 */
async function checkAndNotifyCuts(entries) {
    const summary = { alerted: 0, rcas: [], matched: 0 };
    if (!entries || entries.length === 0) return summary;

    const settings = configManager.getSettings();
    if (settings.cutAlertEnabled === false) {
        logger.info('[Cortes] Alerta de corte resolvido DESATIVADO nas configurações. Pulando verificação.');
        return summary;
    }

    logger.debug(`[Cortes] Verificando cortes para ${entries.length} novos desbloqueios...`);
    const fallbackTargetNumber = String(settings.cutFallbackNumber || '5561983391951');

    const matchedCuts = [];

    // Uma única conexão Oracle para o lote inteiro (antes era 1 por produto)
    let sharedConn = null;
    try {
        sharedConn = await getConnection();
        for (const entry of entries) {
            const codProd = entry.CODPROD;
            const codFilial = String(entry.CODFILIAL);
            const qtDisp = Number(entry.QTDISP);

            // Busca cortes/faltas/rejeitos para o produto e filial
            const cuts = await getPendingCuts(codProd, codFilial, sharedConn);
            if (cuts.length === 0) continue;

            for (const cut of cuts) {
                const cutKey = `${cut.NUMPED}-${cut.CODPROD}`;
                if (processedCuts.has(cutKey)) continue;

                // Regra de negócio: só avisa se o que chegou supre a necessidade COMPLETA
                const qtFalta = Number(cut.QT_FALTA);
                if (qtDisp >= qtFalta) {
                    matchedCuts.push({
                        ...cut,
                        qtDisp
                    });
                }
            }
        }
    } finally {
        if (sharedConn) { try { await sharedConn.close(); } catch (e) { /* ignore */ } }
    }

    summary.matched = matchedCuts.length;
    if (matchedCuts.length === 0) return summary;

    // Agrupa por RCA do vendedor
    const groupedByRca = {};
    for (const cut of matchedCuts) {
        const rca = String(cut.RCA).trim();
        if (!groupedByRca[rca]) {
            groupedByRca[rca] = {
                rca: rca,
                nome_rca: cut.NOME_RCA,
                pedidos: {}
            };
        }

        const numPed = String(cut.NUMPED);
        if (!groupedByRca[rca].pedidos[numPed]) {
            groupedByRca[rca].pedidos[numPed] = {
                numped: numPed,
                codcli: cut.CODCLI,
                cliente: cut.CLIENTE,
                codfilial: cut.CODFILIAL,
                data: cut.DATA,
                items: []
            };
        }

        if (!groupedByRca[rca].pedidos[numPed].items.some(i => i.codprod === cut.CODPROD)) {
            groupedByRca[rca].pedidos[numPed].items.push({
                codprod: cut.CODPROD,
                descricao: cut.DESCRICAO,
                qt_falta: cut.QT_FALTA,
                qtDisp: cut.qtDisp
            });
        }
    }

    const getFirstName = (fullName) => {
        if (!fullName) return 'vendedor';
        const firstWord = fullName.trim().split(/\s+/)[0];
        return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    };

    // Envia uma mensagem agrupada para cada RCA
    for (const [rca, group] of Object.entries(groupedByRca)) {
        const firstName = getFirstName(group.nome_rca);

        const ordersBlocks = [];
        for (const ped of Object.values(group.pedidos)) {
            const itemLines = ped.items.map(item => {
                return `📦 *${item.codprod}* - ${item.descricao}\n   ├ Qtd do Corte: *${item.qt_falta}un*\n   └ Qtd que Chegou: *${item.qtDisp}un*`;
            }).join('\n\n');

            const dateStr = ped.data ? new Date(ped.data).toLocaleDateString('pt-BR') : '--';
            const block = `📝 *Pedido:* ${ped.numped}\n👤 *Cliente:* ${ped.codcli} - ${ped.cliente}\n📅 *Data:* ${dateStr}\n\n${itemLines}`;
            ordersBlocks.push(block);
        }

        const introTemplates = [
            `Olá, *${firstName}*! 👋\nEi, passando correndo pra te dar uma notícia maravilhosa! 🏃‍♀️💨\nAdivinha quem voltou pro estoque? Aquele produto que cortou no seu pedido chegou! 🎉`,
            `Olá, *${firstName}*! 👋\nAlerta de faturamento na área! 🚨\nO estoque ressuscitou aquele item do seu pedido. Fila liberada, hora de fazer a venda cantar! 💸⚡`,
            `Olá, *${firstName}*! 👋\nOlha só quem apareceu! 👀\nOs produtos que estavam em corte já estão disponíveis. Vamos fechar essa venda hoje? 🚀`
        ];

        const randomIntro = introTemplates[Math.floor(Math.random() * introTemplates.length)];
        const message = `✨ *CORTE RESOLVIDO* ✨\n\n${randomIntro}\n\n${ordersBlocks.join('\n\n──────────────────────────\n\n')}`;

        // Determina o número de telefone do vendedor para envio real
        let targetNumber = fallbackTargetNumber;
        let isRealSeller = false;

        try {
            const contacts = contactsManager.getContacts();
            const rcaStr = String(group.rca).trim();
            const seller = contacts.find(c => 
                c.role === 'vendedor' && 
                c.phone && 
                c.rcaCode && 
                c.rcaCode.split(',').map(r => r.trim()).includes(rcaStr)
            );

            if (seller) {
                targetNumber = seller.phone;
                isRealSeller = true;
                logger.info(`[Cortes] Enviando alerta para ${seller.name} (${seller.phone}) - RCA ${rcaStr}`);
            } else {
                logger.warn(`[Cortes] RCA ${rcaStr} não cadastrado como vendedor. Usando número admin como fallback.`);
            }
        } catch (e) {
            logger.error(`[Cortes] Erro ao buscar dados de contatos para RCA ${group.rca}: ${e.message}`);
        }

        const details = {
            type: 'cut_resolved',
            rca: group.rca,
            nome_rca: group.nome_rca,
            pedidos: Object.values(group.pedidos),
            routedToRealSeller: isRealSeller,
            realTargetPhone: targetNumber
        };

        if (whatsapp.isClientReady()) {
            const totalItemsCount = Object.values(group.pedidos).reduce((sum, p) => sum + p.items.length, 0);
            logger.info(`[Cortes] Enviando alerta de corte resolvido agrupado (RCA ${group.rca}, ${Object.keys(group.pedidos).length} pedidos, ${totalItemsCount} itens) para ${targetNumber}...`);
            const sent = await whatsapp.sendToNumber(targetNumber, message, totalItemsCount, details);
            if (sent) {
                logger.info(`✅ [Cortes] Alerta de corte enviado para ${targetNumber}`);
                summary.alerted++;
                summary.rcas.push({ rca: group.rca, nome: group.nome_rca, real: isRealSeller });
                // Marca todos os itens deste grupo como enviados
                for (const ped of Object.values(group.pedidos)) {
                    for (const item of ped.items) {
                        processedCuts.add(`${ped.numped}-${item.codprod}`);
                    }
                }
                saveProcessedCuts();
            } else {
                logger.error(`❌ [Cortes] Falha ao enviar alerta para ${targetNumber}`);
            }
            // Pequeno intervalo entre envios de vendedores diferentes
            await new Promise(r => setTimeout(r, 2000));
        } else {
            logger.warn(`⚠️ [Cortes] WhatsApp não está pronto. Alerta para o RCA ${group.rca} não enviado.`);
        }
    }

    // Limita o tamanho do cache de cortes processados
    if (processedCuts.size > 2000) {
        const arr = [...processedCuts];
        processedCuts = new Set(arr.slice(arr.length - 1000));
        saveProcessedCuts();
    }

    return summary;
}

module.exports = { checkAndNotifyCuts };
