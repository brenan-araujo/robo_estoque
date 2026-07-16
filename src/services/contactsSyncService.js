const { getConnection, oracledb } = require('../config/database');
const contactsManager = require('../utils/contactsManager');
const { CronJob } = require('cron');
const logger = require('../utils/logger');

let cronJob = null;

function normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = String(phone).replace(/\D/g, '').trim();
    if (!cleaned) return '';
    if (cleaned.length === 10 || cleaned.length === 11) {
        cleaned = '55' + cleaned;
    }
    return cleaned;
}

/**
 * Executa a sincronização entre a PCUSUARI do Oracle e o contacts.json local
 */
async function syncContactsWithOracle() {
    logger.info('🔄 Iniciando sincronização diária de contatos com o banco Oracle (PCUSUARI)...');
    let connection;
    try {
        connection = await getConnection();
        
        const localContacts = [...contactsManager.getContacts()];
        
        // Query para buscar os vendedores ativos no mês corrente
        const query = `
            SELECT DISTINCT
                U.CODUSUR,
                U.NOME AS NOME_VENDEDOR,
                U.CODFILIAL,
                F.RAZAOSOCIAL AS NOME_FILIAL,
                U.TELEFONE1,
                U.TELEFONE2,
                U.PSA_TELWHATS,
                U.EMAIL,
                U.EMAIL2
            FROM PCUSUARI U
            LEFT JOIN PCFILIAL F ON F.CODIGO = U.CODFILIAL
            JOIN PCMETA M ON M.CODUSUR = U.CODUSUR
            WHERE U.BLOQUEIO = 'N'
            AND U.CODFILIAL IS NOT NULL
            AND U.NOME NOT LIKE '%PROSPECT%'
            AND U.NOME NOT LIKE '%**%'
            AND M.DATA >= TRUNC(SYSDATE, 'MM')
            AND M.DATA < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), 1)
            ORDER BY U.CODFILIAL, U.CODUSUR
        `;
        
        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        logger.info(`🔍 Banco Oracle retornou ${result.rows.length} vendedores ativos para o mês corrente.`);
        
        const oracleSellersMap = {};
        result.rows.forEach(r => {
            const rcaCode = String(r.CODUSUR).trim();
            oracleSellersMap[rcaCode] = r;
        });
        
        let updatedContactsList = [];
        let addedCount = 0;
        let removedCount = 0;
        let updatedCount = 0;
        
        // Mapear contatos locais por Código RCA para busca rápida (ignorando N/A)
        const localRcaMap = {};
        localContacts.forEach(c => {
            if (c.rcaCode && c.rcaCode !== 'N/A') {
                localRcaMap[String(c.rcaCode).trim()] = c;
            }
        });
        
        // 1. Processar contatos locais existentes (atualizar dados ou remover se inativo)
        localContacts.forEach(local => {
            // Se o contato não tem RCA ou é suporte/admin ("N/A"), preservamos e não sincronizamos
            if (!local.rcaCode || local.rcaCode === 'N/A') {
                updatedContactsList.push(local);
                return;
            }
            
            // Só removemos/inativamos automaticamente se for vendedor
            // Supervisores e administradores são preservados mesmo sem meta no mês
            if (local.role !== 'vendedor') {
                updatedContactsList.push(local);
                return;
            }
            
            const rcaStr = String(local.rcaCode).trim();
            const oracleData = oracleSellersMap[rcaStr];
            
            if (!oracleData) {
                // Vendedor não está mais ativo/bloqueado na PCUSUARI -> removemos dos contatos
                logger.info(`➖ Removendo vendedor inativo/bloqueado: ${local.name} (RCA: ${local.rcaCode})`);
                removedCount++;
                return; // Não adiciona à lista atualizada (remove)
            }
            
            // Vendedor ativo -> verificar se houve mudança cadastral
            const dbName = oracleData.NOME_VENDEDOR ? oracleData.NOME_VENDEDOR.trim() : '';
            const dbFilialCode = oracleData.CODFILIAL ? oracleData.CODFILIAL.trim() : '';
            const dbEmail = oracleData.EMAIL ? oracleData.EMAIL.trim() : (oracleData.EMAIL2 ? oracleData.EMAIL2.trim() : '');
            
            const nameUpper = dbName.toUpperCase();
            const isInternal = nameUpper.includes('INES GOMES') || 
                               nameUpper.includes('FLAVIA DUTRA') || 
                               nameUpper.includes('DEBORA MARIA') || 
                               nameUpper.includes('NAIARA SANTOS');
            
            const expectedFilialValue = isInternal ? 'TODAS' : dbFilialCode;
            
            let changed = false;
            const updatedContact = { ...local };
            
            if (local.name !== dbName) {
                logger.info(`🔄 Atualizando nome do vendedor RCA ${local.rcaCode}: "${local.name}" ➔ "${dbName}"`);
                updatedContact.name = dbName;
                changed = true;
            }
            
            if (local.filial !== expectedFilialValue) {
                logger.info(`🔄 Atualizando filial do vendedor RCA ${local.rcaCode}: "${local.filial}" ➔ "${expectedFilialValue}"`);
                updatedContact.filial = expectedFilialValue;
                changed = true;
            }
            
            // Opcional: preenche telefone se estiver em branco no local mas preenchido no banco
            if (!local.phone || local.phone === 'SEM_TELEFONE') {
                let dbVal = oracleData.PSA_TELWHATS !== null && oracleData.PSA_TELWHATS !== undefined ? oracleData.PSA_TELWHATS : (oracleData.TELEFONE1 || oracleData.TELEFONE2 || '');
                let dbPhone = normalizePhone(dbVal);
                if (dbPhone) {
                    logger.info(`📞 Preenchendo telefone do vendedor RCA ${local.rcaCode} a partir do banco: ${dbPhone}`);
                    updatedContact.phone = dbPhone;
                    changed = true;
                }
            }

            // Puxa e atualiza o e-mail se for alterado ou preenchido no Winthor
            if (dbEmail && local.email !== dbEmail) {
                logger.info(`📧 Atualizando/Preenchendo e-mail do vendedor RCA ${local.rcaCode}: "${local.email || ''}" ➔ "${dbEmail}"`);
                updatedContact.email = dbEmail;
                changed = true;
            }
            
            if (changed) {
                updatedCount++;
            }
            
            updatedContactsList.push(updatedContact);
        });
        
        // 2. Adicionar novos vendedores que não existem localmente
        result.rows.forEach(r => {
            const rcaCode = String(r.CODUSUR).trim();
            
            const exists = localRcaMap[rcaCode];
            if (!exists) {
                let val = r.PSA_TELWHATS !== null && r.PSA_TELWHATS !== undefined ? r.PSA_TELWHATS : (r.TELEFONE1 || r.TELEFONE2 || '');
                const phone = normalizePhone(val);
                
                // Se não possui telefone cadastrado no Oracle, pula (não deve entrar)
                if (!phone) {
                    logger.debug(`Vendedor ${r.NOME_VENDEDOR} (RCA ${rcaCode}) não possui telefone no Oracle. Pulando.`);
                    return;
                }
                
                const dbName = r.NOME_VENDEDOR ? r.NOME_VENDEDOR.trim() : '';
                const dbFilial = r.CODFILIAL ? r.CODFILIAL.trim() : '';
                
                const nameUpper = dbName.toUpperCase();
                const isInternal = nameUpper.includes('INES GOMES') || 
                                   nameUpper.includes('FLAVIA DUTRA') || 
                                   nameUpper.includes('DEBORA MARIA') || 
                                   nameUpper.includes('NAIARA SANTOS');
                
                // Determina cargo e ID com base no nome (para tratar novos supervisores de forma consistente)
                let role = 'vendedor';
                let id = `rca_${rcaCode}`;
                let supervisingFiliais = undefined;
                let supervisingRcas = undefined;
                
                if (nameUpper.includes('KEYLA SALES')) {
                    role = 'supervisor';
                    id = 'supervisor_keyla_sales';
                    supervisingFiliais = ['20', '23'];
                } else if (nameUpper.includes('LEANDRO BORJA')) {
                    role = 'supervisor';
                    id = 'supervisor_leandro_borja';
                    supervisingFiliais = ['21', '22'];
                } else if (nameUpper.includes('OZEAS DE CASTRO') || nameUpper.includes('OZEAS CASTRO')) {
                    role = 'supervisor';
                    id = 'supervisor_ozeas_de_castro';
                    supervisingFiliais = ['21', '22'];
                } else if (nameUpper.includes('ELIANE AREA')) {
                    role = 'supervisor';
                    id = 'supervisor_eliane_area';
                    supervisingRcas = ['84', '99', '91', '88'];
                } else if (nameUpper.includes('POLIANI SANTOS')) {
                    role = 'supervisor';
                    id = 'supervisor_poliani_santos';
                    supervisingRcas = ['108', '1102'];
                }
                
                const dbEmail = r.EMAIL ? r.EMAIL.trim() : (r.EMAIL2 ? r.EMAIL2.trim() : '');
                logger.info(`➕ Adicionando novo vendedor ativo: ${dbName} (RCA: ${rcaCode}, Filial: ${isInternal ? 'TODAS' : dbFilial})`);
                
                updatedContactsList.push({
                    id,
                    name: dbName,
                    phone: phone || 'SEM_TELEFONE',
                    email: dbEmail || '',
                    role,
                    filial: isInternal ? 'TODAS' : dbFilial,
                    rcaCode,
                    ...(supervisingFiliais && { supervisingFiliais }),
                    ...(supervisingRcas && { supervisingRcas })
                });
                addedCount++;
            }
        });
        
        // 3. Salvar as alterações se houver
        if (addedCount > 0 || removedCount > 0 || updatedCount > 0) {
            contactsManager.saveContacts(updatedContactsList);
            logger.info(`✅ Sincronização concluída. Adicionados: ${addedCount}, Removidos: ${removedCount}, Atualizados: ${updatedCount}.`);
        } else {
            logger.info('✅ Sincronização concluída. Nenhuma alteração cadastral detectada.');
        }
        
    } catch (err) {
        logger.error(`❌ Erro durante a sincronização de contatos com Oracle: ${err.message}`);
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Inicializa o agendador da sincronização diária de contatos
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        logger.info('⏹️ Cron anterior de sincronização de contatos finalizado.');
    }
    
    // Executa diariamente às 04:00 AM
    const cronTime = '00 04 * * *';
    logger.info(`⏰ Agendando sincronização diária de vendedores (cron: "${cronTime}")`);
    try {
        cronJob = new CronJob(cronTime, async () => {
            try {
                await syncContactsWithOracle();
            } catch (err) {
                logger.error(`❌ Falha na execução agendada do sync de contatos: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');
        
        cronJob.start();
        logger.info('🚀 Cron job de sincronização de contatos inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron job de sincronização de contatos: ${e.message}`);
    }
}

module.exports = {
    syncContactsWithOracle,
    initScheduler
};
