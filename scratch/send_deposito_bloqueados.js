/**
 * send_deposito_bloqueados.js
 * 
 * Dispara AGORA o relatório de itens bloqueados/avariados do depósito
 * para a filial 20+6, enviando para o Brenan Marketing via WhatsApp.
 * 
 * Uso: node scratch/send_deposito_bloqueados.js
 */
require('dotenv').config();

const db = require('../src/config/database');
const whatsapp = require('../src/services/whatsappService');
const { getBlockedStockData, generateBlockedStockExcel } = require('../src/services/warehouseBlockedReportService');
const logger = require('../src/utils/logger');
const path = require('path');
const fs = require('fs');

// Brenan Marketing
const TARGET_NUMBERS = ['5562996101684'];
const FILIAL = '20 + 6';
const FILIAL_LABEL = 'BRAGO BRASÍLIA (20+6)';

async function main() {
    let exitCode = 0;

    try {
        // 1. Conectar ao Oracle
        console.log('🔌 Conectando ao banco Oracle...');
        await db.initialize();

        // 2. Buscar dados
        console.log('📊 Buscando itens bloqueados/avariados do depósito (filial 20+6)...');
        const rows = await getBlockedStockData(FILIAL);
        console.log(`✅ Encontrados: ${rows.length} produtos parados no depósito.`);

        if (rows.length === 0) {
            console.log('ℹ️  Nenhum item bloqueado ou avariado encontrado. Encerrando sem envio.');
            return;
        }

        // 3. Gerar Excel temporário
        const timestamp = Date.now();
        const excelPath = path.join(__dirname, '..', 'data', `deposito_bloqueados_avarias_20_6_${timestamp}.xlsx`);
        console.log('📝 Gerando planilha Excel...');
        await generateBlockedStockExcel(rows, FILIAL_LABEL, excelPath);
        console.log(`✅ Excel gerado: ${excelPath}`);

        // 4. Montar resumo KPI
        const totBloq   = rows.reduce((s, r) => s + r.QT_BLOQUEADA, 0);
        const totAvaria  = rows.reduce((s, r) => s + r.QT_AVARIA, 0);
        const totValor   = rows.reduce((s, r) => s + r.VALOR_PARADO, 0);
        const nAvaria    = rows.filter(r => r.QT_AVARIA > 0).length;

        const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const caption =
            `📋 *Raio-X do Depósito — Itens Parados (Bloqueados / Avariados)*\n` +
            `📍 *Filial:* ${FILIAL_LABEL}\n` +
            `🗓️ *Data:* ${today}\n\n` +
            `📦 *Produtos parados:* ${rows.length}\n` +
            `🔒 *Qt. Bloqueada:* ${Math.round(totBloq).toLocaleString('pt-BR')} un.\n` +
            `💥 *Qt. Avaria:* ${Math.round(totAvaria).toLocaleString('pt-BR')} un. (${nAvaria} produtos)\n` +
            `💰 *Valor total parado:* R$ ${totValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
            `_A planilha em anexo traz o endereçamento WMS (Rua/Prédio/Apto/Módulo) e a coluna "Sugestão de Ação" para apoiar a decisão do gestor do depósito — desbloquear, indenizar ou descartar._`;

        // 5. Conectar WhatsApp e enviar
        console.log('📱 Conectando ao WhatsApp...');
        await whatsapp.initialize({
            onQr: (qr) => {
                console.log('⚠️  Escaneie o QR Code acima para autenticar o WhatsApp.');
            },
            onReady: () => {
                console.log('✅ WhatsApp conectado!');
            }
        });

        // Aguarda estabilização
        await new Promise(r => setTimeout(r, 5000));

        console.log(`📤 Enviando planilha para: ${TARGET_NUMBERS.join(', ')}...`);
        for (const num of TARGET_NUMBERS) {
            const ok = await whatsapp.sendFileToNumber(num, excelPath, caption);
            if (ok) {
                console.log(`✅ Planilha enviada para ${num}`);
            } else {
                console.error(`❌ Falha ao enviar para ${num}`);
                exitCode = 1;
            }
        }

        // 6. Limpar arquivo temporário
        try {
            fs.unlinkSync(excelPath);
            console.log('🗑️  Arquivo temporário removido.');
        } catch (e) {
            console.warn(`⚠️  Não foi possível remover arquivo temporário: ${e.message}`);
        }

    } catch (err) {
        console.error(`❌ Erro: ${err.message}`);
        if (err.stack) console.error(err.stack);
        exitCode = 1;
    } finally {
        try { await db.close(); } catch (e) {}
        try { await whatsapp.destroy(); } catch (e) {}
        process.exit(exitCode);
    }
}

console.log('⏳ Iniciando em 3 segundos...');
setTimeout(main, 3000);
