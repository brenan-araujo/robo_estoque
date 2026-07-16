require('dotenv').config();
const { getConnection, oracledb } = require('../src/config/database');

async function check() {
    let conn;
    try {
        conn = await getConnection();

        // Verifica cadastro do produto
        const r1 = await conn.execute(
            `SELECT codprod, descricao, revenda, codepto, codfornec, obs2, dtexclusao
             FROM pcprodut WHERE codprod = 18179`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('=== CADASTRO DO PRODUTO ===');
        console.log(JSON.stringify(r1.rows, null, 2));

        // Verifica vendas nos últimos 90 dias
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

        // Verifica estoque
        const r3 = await conn.execute(
            `SELECT codfilial, qtestger, qtreserv, qtbloqueada
             FROM pcest WHERE codprod = 18179 AND codfilial IN ('6','20','21','22','23')`,
            {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== ESTOQUE ===');
        console.log(JSON.stringify(r3.rows, null, 2));

        // Verifica pedidos pendentes
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
        if (conn) await conn.close();
        process.exit(0);
    }
}

check().catch(err => { console.error(err); process.exit(1); });
