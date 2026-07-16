require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- TEST QUERY FOR PENDING ARRIVALS ---');
        // Let's count pending arrivals by filial
        const countByFilial = await conn.execute(
            `SELECT 
                P.CODFILIAL,
                COUNT(DISTINCT P.NUMPED) AS PEDIDOS,
                COUNT(I.CODPROD) AS ITENS,
                SUM(I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) AS SALDO_TOTAL
             FROM BRAGO.PCPEDIDO P
             JOIN BRAGO.PCITEM I ON P.NUMPED = I.NUMPED
             WHERE (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) > 0
               AND P.DTENTRADAESTOQUE IS NULL
             GROUP BY P.CODFILIAL
             ORDER BY P.CODFILIAL`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('Pending arrivals by filial:');
        console.table(countByFilial.rows);

        // Let's run a query for a sample of pending items, showing their addresses
        const querySample = `
            SELECT * FROM (
                SELECT 
                    P.CODFILIAL,
                    P.CODFORNEC,
                    (SELECT F.FANTASIA FROM BRAGO.PCFORNEC F WHERE F.CODFORNEC = P.CODFORNEC) AS FORNECEDOR,
                    I.CODPROD,
                    PROD.DESCRICAO AS PROD_DESC,
                    -- Stock Available
                    (SELECT NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0)
                     FROM BRAGO.PCEST E 
                     WHERE E.CODPROD = I.CODPROD AND E.CODFILIAL = P.CODFILIAL) AS ESTOQUE_DISP_FILIAL,
                    I.QTPEDIDA - NVL(I.QTENTREGUE, 0) AS SALDO_PEDIDO,
                    P.DTPREVENT,
                    -- Addresses from PCEST (filial-specific)
                    (SELECT E.RUA FROM BRAGO.PCEST E WHERE E.CODPROD = I.CODPROD AND E.CODFILIAL = P.CODFILIAL) AS RUA_PCEST,
                    (SELECT E.APTO FROM BRAGO.PCEST E WHERE E.CODPROD = I.CODPROD AND E.CODFILIAL = P.CODFILIAL) AS APTO_PCEST,
                    -- Addresses from PCPRODUT (general)
                    PROD.RUA AS RUA_PCPRODUT,
                    PROD.PREDIO AS PREDIO_PCPRODUT,
                    PROD.APTO AS APTO_PCPRODUT
                FROM BRAGO.PCITEM I
                JOIN BRAGO.PCPEDIDO P ON I.NUMPED = P.NUMPED
                JOIN BRAGO.PCPRODUT PROD ON I.CODPROD = PROD.CODPROD
                WHERE (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) > 0
                  AND P.DTENTRADAESTOQUE IS NULL
                ORDER BY P.DTPREVENT ASC
            ) WHERE ROWNUM <= 20
        `;

        try {
            const sampleRes = await conn.execute(querySample, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            console.log('Sample of pending items with addresses:');
            console.table(sampleRes.rows);
        } catch (err) {
            console.log('Sample select failed:', err.message);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
