const fs = require('fs');
const path = require('path');
const { CronJob } = require('cron');
const { getConnection, oracledb } = require('../config/database');
const { generateIonPendingExcel } = require('./ionPendingExcelService');
const whatsapp = require('./whatsappService');
const logger = require('../utils/logger');

const SQL_PATH = path.join(__dirname, '..', '..', 'sql', 'produtos_pendentes_ion_comestoque.sql');

// Destinatários padrão do relatório semanal (editável aqui).
// Bianca Melo e Rivelino Mendes.
const NOTIFY_NUMBERS = ['5561999616441', '5561998097323'];

// Sexta-feira às 08:00 (America/Sao_Paulo)
const CRON_TIME = '0 8 * * 5';

let cronJob = null;

/**
 * Executa a query, gera a planilha mesclada e retorna { excelPath, rows }.
 */
async function generate() {
    const sql = fs.readFileSync(SQL_PATH, 'utf8').replace(/;\s*$/, '');
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = result.rows || [];
        const excelPath = await generateIonPendingExcel(rows);
        return { excelPath, rows };
    } finally {
        if (connection) { try { await connection.close(); } catch (e) {} }
    }
}

function buildCaption(rows) {
    const produtos = new Set(rows.map(r => r.CODPROD)).size;
    const fornecedores = new Set(rows.map(r => r.FORNECEDOR)).size;
    const dataStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return (
        `📋 *Produtos com Estoque Pendentes de Integração (ION)*\n` +
        `🗓️ ${dataStr}\n\n` +
        `Produtos *com estoque parado* mas *bloqueados para venda* por pendência de cadastro (filiais 6/20, 21, 22, 23).\n\n` +
        `📊 *Resumo*\n` +
        `• Produtos: *${produtos.toLocaleString('pt-BR')}*\n` +
        `• Ocorrências (produto×filial): *${rows.length.toLocaleString('pt-BR')}*\n` +
        `• Fornecedores: *${fornecedores.toLocaleString('pt-BR')}*\n\n` +
        `📌 Planilha *mesclada por produto*: uma linha por *filial/região* mostrando o *Problema* (onde falta preço/tributação), o estoque e a região a corrigir.`
    );
}

/**
 * Gera e envia o relatório de produtos pendentes de cadastro.
 * @param {string|null} testPhone Se informado, envia só para esse número (teste).
 * @returns {Promise<Object>} Resumo da execução.
 */
async function runIonPendingReport(testPhone = null) {
    logger.info(`📋 Iniciando relatório de produtos pendentes de cadastro (ION)${testPhone ? ` (TESTE → ${testPhone})` : ''}...`);

    const { excelPath, rows } = await generate();
    logger.info(`✅ Planilha gerada (${rows.length} ocorrências) em: ${excelPath}`);

    if (!whatsapp.isClientReady()) {
        throw new Error('O cliente do WhatsApp não está conectado.');
    }

    const targets = testPhone ? [testPhone] : NOTIFY_NUMBERS;
    const caption = buildCaption(rows);

    let sentCount = 0;
    for (const number of targets) {
        logger.info(`Enviando relatório ION para ${number}...`);
        const sent = await whatsapp.sendFileToNumber(number, excelPath, caption, { type: 'ion_pending' });
        if (sent) sentCount++;
        await new Promise(r => setTimeout(r, 2000));
    }

    logger.info(`📊 Relatório ION enviado para ${sentCount}/${targets.length} destinatário(s).`);
    return { success: true, excelPath, rowsCount: rows.length, targets, sentCount };
}

/**
 * Agenda o envio semanal (sexta-feira).
 */
function initScheduler() {
    if (cronJob) {
        cronJob.stop();
        logger.info('⏹️ Cron anterior do relatório ION finalizado.');
    }
    logger.info(`⏰ Agendando relatório semanal de produtos pendentes de cadastro (cron: "${CRON_TIME}")`);
    try {
        cronJob = new CronJob(CRON_TIME, async () => {
            try {
                if (whatsapp.isClientReady()) {
                    await runIonPendingReport();
                } else {
                    logger.warn('⚠️ WhatsApp desconectado. Relatório ION semanal pulado.');
                }
            } catch (err) {
                logger.error(`❌ Falha na execução agendada do relatório ION: ${err.message}`);
            }
        }, null, true, 'America/Sao_Paulo');
        cronJob.start();
        logger.info('🚀 Cron do relatório ION inicializado com sucesso.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron do relatório ION: ${e.message}`);
    }
}

module.exports = { generate, runIonPendingReport, initScheduler, NOTIFY_NUMBERS };
