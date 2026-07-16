require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- PURCHASE ORDERS POSITION COUNT ---');
        const posCount = await conn.execute(
            `SELECT POSICAO, COUNT(*) AS CNT 
             FROM BRAGO.PCPEDIDO 
             WHERE DTPREVENT >= TRUNC(SYSDATE) - 30
             GROUP BY POSICAO`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(posCount.rows);

        console.log('--- SAMPLE OF OPEN PURCHASE ORDERS ---');
        // Let's find orders where there is balance to receive
        const openOrders = await conn.execute(
            `SELECT * FROM (
                SELECT 
                    P.NUMPED, 
                    P.CODFILIAL, 
                    P.POSICAO, 
                    P.DTPREVENT, 
                    P.DTERROPREV,
                    P.CODFORNEC,
                    (SELECT F.FANTASIA FROM BRAGO.PCFORNEC F WHERE F.CODFORNEC = P.CODFORNEC) AS FORNECEDOR,
                    COUNT(I.CODPROD) AS ITENS,
                    SUM(I.QTPEDIDA) AS TOTAL_PEDIDO,
                    SUM(NVL(I.QTENTREGUE, 0)) AS TOTAL_ENTREGUE,
                    SUM(I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) AS SALDO
                FROM BRAGO.PCPEDIDO P
                JOIN BRAGO.PCITEM I ON P.NUMPED = I.NUMPED
                WHERE (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) > 0
                  AND P.POSICAO IN ('P', 'B', 'A', 'L') -- let's check positions
                  AND P.DTENTRADAESTOQUE IS NULL
                GROUP BY P.NUMPED, P.CODFILIAL, P.POSICAO, P.DTPREVENT, P.DTERROPREV, P.CODFORNEC
                ORDER BY P.DTPREVENT ASC
            ) WHERE ROWNUM <= 15`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(openOrders.rows);

        console.log('--- DATES RANGE OF PENDING ORDERS ---');
        const dateRange = await conn.execute(
            `SELECT 
                MIN(P.DTPREVENT) AS MIN_PREV, 
                MAX(P.DTPREVENT) AS MAX_PREV,
                COUNT(DISTINCT P.NUMPED) AS PEDIDOS_PENDENTES
             FROM BRAGO.PCPEDIDO P
             JOIN BRAGO.PCITEM I ON P.NUMPED = I.NUMPED
             WHERE (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) > 0
               AND P.POSICAO IN ('P', 'B')
               AND P.DTENTRADAESTOQUE IS NULL`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(dateRange.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
