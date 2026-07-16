/**
 * Diagnóstico do produto 18179 no relatório de compras
 */
require('dotenv').config();

const database = require('./config/database');
const oracledb = require('oracledb');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();

    try {
        // 1. Cadastro do produto
        const r1 = await conn.execute(
            `SELECT codprod, descricao, revenda, codepto, codfornec, obs2, dtexclusao
             FROM pcprodut WHERE codprod = 18179`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== CADASTRO DO PRODUTO ===');
        console.log(JSON.stringify(r1.rows, null, 2));

        // 2. Vendas nos últimos 90 dias
        const r2 = await conn.execute(
            `SELECT codfilial, COUNT(DISTINCT TRUNC(dtmov)) as dias_com_venda, SUM(qt) as total_qt
             FROM pcmov
             WHERE codprod = 18179
               AND codoper = 'S'
               AND dtmov >= TRUNC(SYSDATE) - 90
               AND codfilial IN ('6','20','21','22','23')
             GROUP BY codfilial`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== VENDAS ULTIMOS 90 DIAS ===');
        console.log(JSON.stringify(r2.rows, null, 2));

        // 3. Estoque
        const r3 = await conn.execute(
            `SELECT codfilial, qtestger, qtreserv, qtbloqueada, qtindeniz
             FROM pcest WHERE codprod = 18179 AND codfilial IN ('6','20','21','22','23')`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== ESTOQUE POR FILIAL ===');
        console.log(JSON.stringify(r3.rows, null, 2));

        // 4. Pedidos pendentes
        const r4 = await conn.execute(
            `SELECT i.codfilialretira, SUM(i.qt) as saldo_pedido
             FROM pcpedi i
             WHERE i.codprod = 18179
               AND i.posicao IN ('P','B')
               AND i.codfilialretira IN ('6','20','21','22','23')
             GROUP BY i.codfilialretira`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== PEDIDOS PENDENTES ===');
        console.log(JSON.stringify(r4.rows, null, 2));

    } finally {
        await conn.close();
        await database.close();
        process.exit(0);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
