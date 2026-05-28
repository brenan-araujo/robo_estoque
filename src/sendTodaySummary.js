/**
 * Script para enviar um resumo das entradas de hoje via WhatsApp
 * Rode: node src/sendTodaySummary.js
 */
require('dotenv').config();

const database = require('./config/database');
const { oracledb } = require('./config/database');
const whatsapp = require('./services/whatsappService');
const { NOTIFY_NUMBERS } = require('./config/groups');
const logger = require('./utils/logger');

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  📤 Enviar Resumo de Hoje via WhatsApp      ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    try {
        // 1. Conecta ao Oracle
        await database.initialize();

        // 2. Busca entradas de hoje agrupadas por filial
        const conn = await database.getConnection();
        const result = await conn.execute(
            `SELECT 
                M.CODPROD,
                P.DESCRICAO,
                M.CODFILIAL,
                F.RAZAOSOCIAL AS NOMEFILIAL,
                M.QT,
                M.NUMNOTA,
                FORN.FANTASIA AS FORNECEDOR,
                (SELECT CASE WHEN COUNT(*) > 0 THEN 'S' ELSE 'N' END
                 FROM PCPEDI I
                 WHERE I.CODPROD = M.CODPROD AND I.POSICAO IN ('P', 'B')
                 AND (
                     (M.CODFILIAL = '20' AND I.CODFILIALRETIRA IN ('20', '6'))
                     OR
                     (M.CODFILIAL <> '20' AND I.CODFILIALRETIRA = M.CODFILIAL)
                 )
                ) AS TEM_PENDENCIA
             FROM PCMOV M
             JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
             LEFT JOIN PCFILIAL F ON F.CODIGO = M.CODFILIAL
             LEFT JOIN PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
             WHERE M.DTMOV >= TRUNC(SYSDATE)
             AND M.CODOPER IN ('E', 'EB')
             AND M.QT > 0
             ORDER BY M.CODFILIAL, P.DESCRICAO`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await conn.close();

        if (result.rows.length === 0) {
            logger.info('Nenhuma entrada hoje.');
            await database.close();
            process.exit(0);
        }

        // 3. Agrupa por filial
        const grouped = {};
        for (const row of result.rows) {
            const filial = String(row.CODFILIAL);
            if (!grouped[filial]) {
                grouped[filial] = {
                    nome: row.NOMEFILIAL || `Filial ${filial}`,
                    items: []
                };
            }
            grouped[filial].items.push({
                codProd: row.CODPROD,
                descricao: row.DESCRICAO,
                qt: row.QT,
                fornecedor: row.FORNECEDOR,
                temPendencia: row.TEM_PENDENCIA === 'S'
            });
        }

        // 4. Monta mensagem consolidada
        const now = new Date();
        const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        let msg = `📦 *RESUMO DE ENTRADAS — ${now.toLocaleDateString('pt-BR')}*\n\n`;

        for (const [codFilial, data] of Object.entries(grouped)) {
            msg += `🏢 *${data.nome}* (${codFilial})\n\n`;
            
            const porFornecedor = {};
            for (const item of data.items) {
                const forn = item.fornecedor || 'NÃO IDENTIFICADO';
                if (!porFornecedor[forn]) porFornecedor[forn] = [];
                porFornecedor[forn].push(item);
            }

            for (const [forn, items] of Object.entries(porFornecedor)) {
                msg += `FORNECEDOR: *${forn}*\n\n`;

                const pendentes = items.filter(i => i.temPendencia);
                const normais = items.filter(i => !i.temPendencia);

                if (pendentes.length > 0) {
                    msg += `🚨 *ITENS COM PEDIDOS PENDENTES:*\n`;
                    for (const item of pendentes) {
                        msg += `✅ Cód: ${item.codProd} - ${item.descricao} | Qtd: *${item.qt}*\n\n`;
                    }
                    msg += '\n';
                }

                if (normais.length > 0) {
                    if (pendentes.length > 0) msg += `📦 *OUTROS ITENS:*\n`;
                    for (const item of normais) {
                        msg += `✅ Cód: ${item.codProd} - ${item.descricao} | Qtd: *${item.qt}*\n\n`;
                    }
                    msg += '\n';
                }
            }
            msg += `  📋 _${data.items.length} produto(s)_\n\n`;
        }

        msg += `──────────────────\n`;
        msg += `🕐 Gerado em: ${dataHora}`;

        console.log('\n--- PREVIEW DA MENSAGEM ---\n');
        console.log(msg);
        console.log('\n--- FIM PREVIEW ---\n');

        // 5. Conecta ao WhatsApp e envia
        logger.info('Conectando ao WhatsApp...');
        await whatsapp.initialize();

        for (const number of NOTIFY_NUMBERS) {
            logger.info(`Enviando para ${number}...`);
            const sent = await whatsapp.sendToNumber(number, msg);
            if (sent) {
                logger.info(`✅ Mensagem enviada para ${number}!`);
            } else {
                logger.error(`❌ Falha ao enviar para ${number}`);
            }
        }

        // Aguarda um pouco para garantir o envio
        await new Promise(r => setTimeout(r, 3000));

    } catch (err) {
        logger.error(`Erro: ${err.message}`);
    } finally {
        await whatsapp.destroy();
        await database.close();
        process.exit(0);
    }
}

main();
