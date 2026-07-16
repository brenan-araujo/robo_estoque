require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
const { getNewEntries, getFunnelProducts } = require('../src/services/oracleService');
const assert = require('assert');

const BLOCKED_SUPPLIERS = [3, 4, 14566, 14631, 14574, 14573];

async function main() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🧪 Testando Exclusão de Fornecedores        ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    await database.initialize();
    const conn = await database.getConnection();

    try {
        // 1. Busca mapeamento de CODPROD -> CODFORNEC do banco para validação rápida
        console.log('Buscando relação de produtos e fornecedores da base...');
        const prodResult = await conn.execute(
            `SELECT CODPROD, CODFORNEC FROM PCPRODUT`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const prodToSupplierMap = new Map();
        for (const row of prodResult.rows) {
            prodToSupplierMap.set(row.CODPROD, row.CODFORNEC);
        }
        console.log(`Mapeados ${prodToSupplierMap.size} produtos.\n`);

        // 2. Testa getNewEntries dos últimos 30 dias
        console.log('Testando getNewEntries...');
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const entries = await getNewEntries(thirtyDaysAgo);

        console.log(`getNewEntries retornou ${entries.length} registros.`);
        let entriesErrors = 0;
        for (const entry of entries) {
            const supplierId = prodToSupplierMap.get(entry.CODPROD);
            if (BLOCKED_SUPPLIERS.includes(supplierId)) {
                console.error(`❌ Erro: Produto ${entry.CODPROD} (${entry.DESCRICAO}) com fornecedor ${supplierId} foi retornado em getNewEntries!`);
                entriesErrors++;
            }
        }
        if (entriesErrors === 0) {
            console.log('✅ getNewEntries passou no teste de filtragem!\n');
        } else {
            throw new Error(`getNewEntries falhou com ${entriesErrors} registros inválidos.`);
        }

        // 3. Testa getFunnelProducts
        console.log('Testando getFunnelProducts...');
        const funnelProducts = await getFunnelProducts();
        console.log(`getFunnelProducts retornou ${funnelProducts.length} registros.`);
        let funnelErrors = 0;
        for (const prod of funnelProducts) {
            const supplierId = prodToSupplierMap.get(prod.CODPROD);
            if (BLOCKED_SUPPLIERS.includes(supplierId)) {
                console.error(`❌ Erro: Produto ${prod.CODPROD} (${prod.DESCRICAO}) com fornecedor ${supplierId} foi retornado em getFunnelProducts!`);
                funnelErrors++;
            }
        }
        if (funnelErrors === 0) {
            console.log('✅ getFunnelProducts passou no teste de filtragem!\n');
        } else {
            throw new Error(`getFunnelProducts falhou com ${funnelErrors} registros inválidos.`);
        }

        // 4. Testa a query de sendTodaySummary replicando sua lógica
        console.log('Testando a query de sendTodaySummary.js...');
        const summaryResult = await conn.execute(
            `SELECT 
                M.CODPROD,
                P.DESCRICAO,
                M.CODFILIAL,
                M.QT,
                M.CODFORNEC
             FROM PCMOV M
             JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
             WHERE M.DTMOV >= TRUNC(SYSDATE) - 30 -- Usamos 30 dias para garantir que pegamos registros no teste
             AND M.CODFORNEC NOT IN (3, 4, 14566, 14631, 14574, 14573)
             AND M.CODOPER IN ('E', 'EB', 'EP')
             AND M.QT > 0`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`Query do resumo retornou ${summaryResult.rows.length} registros de teste.`);
        let summaryErrors = 0;
        for (const row of summaryResult.rows) {
            if (BLOCKED_SUPPLIERS.includes(row.CODFORNEC)) {
                console.error(`❌ Erro: Registro da PCMOV de hoje com fornecedor ${row.CODFORNEC} foi retornado!`);
                summaryErrors++;
            }
        }
        if (summaryErrors === 0) {
            console.log('✅ Query do sendTodaySummary passou no teste de filtragem!\n');
        } else {
            throw new Error(`Query do resumo falhou com ${summaryErrors} registros inválidos.`);
        }

        console.log('🎉 TODOS OS TESTES DE FILTRAGEM PASSARAM COM SUCESSO!');

    } catch (err) {
        console.error('❌ Falha nos testes de exclusão:', err.message);
        process.exit(1);
    } finally {
        await conn.close();
        await database.close();
    }
}

main();
