require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== ANALISANDO TABELA PCPEDI DE ITENS DE PEDIDO ===');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCPEDI' AND OWNER = 'BRAGO'
               AND (UPPER(COLUMN_NAME) LIKE '%PED%' OR UPPER(COLUMN_NAME) LIKE '%PROD%' OR UPPER(COLUMN_NAME) LIKE '%QTD%' OR UPPER(COLUMN_NAME) LIKE '%QT%')
             ORDER BY COLUMN_ID`,
            [], opt
        );
        console.table(cols.rows.slice(0, 15));

        console.log('\n=== BUSCANDO PEDIDOS DE TRANSFERÊNCIA PENDENTES (CONDVENDA = 5) ===');
        // Posições em WinThor: 'P' = Pendente, 'L' = Liberado, 'F' = Faturado, 'C' = Cancelado
        const pendingOrders = await conn.execute(
            `SELECT 
                C.NUMPED,
                C.CODFILIAL,
                C.CODFILIALNF,
                C.CODCLI,
                C.POSICAO,
                C.DATA AS DT_PEDIDO,
                C.DTENTREGA,
                COUNT(*) AS ITENS,
                SUM(I.QT) AS QTD_TOTAL
             FROM PCPEDC C
             JOIN PCPEDI I ON C.NUMPED = I.NUMPED
             WHERE C.CONDVENDA = 5
               AND C.POSICAO IN ('P', 'L')
             GROUP BY C.NUMPED, C.CODFILIAL, C.CODFILIALNF, C.CODCLI, C.POSICAO, C.DATA, C.DTENTREGA
             ORDER BY C.DATA DESC`,
            [], opt
        );
        console.log(`Encontrados ${pendingOrders.rows.length} pedidos de transferência pendentes.`);
        if (pendingOrders.rows.length > 0) {
            console.table(pendingOrders.rows.slice(0, 10));
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
