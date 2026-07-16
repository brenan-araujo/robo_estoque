require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('Executing rupture detection query...');
        const startTime = Date.now();
        
        const params = {
            pisoEstoque: 0,
            janelaGiro: 90,
            minDiasComVenda: 12,
            janelaVendaRecente: 30
        };

        const query = `
        WITH VENDAS AS (
          SELECT 
            M.CODPROD,
            CASE WHEN M.CODFILIAL = '6' THEN '20' ELSE M.CODFILIAL END AS CODFILIAL_MAPPED,
            COUNT(DISTINCT TRUNC(M.DTMOV)) AS DIAS_COM_VENDA,
            COUNT(DISTINCT CASE WHEN M.DTMOV >= TRUNC(SYSDATE) - :janelaVendaRecente THEN TRUNC(M.DTMOV) END) AS DIAS_COM_VENDA_RECENTE
          FROM PCMOV M
          WHERE M.CODOPER = 'S'
            AND M.DTMOV >= TRUNC(SYSDATE) - :janelaGiro
            AND M.CODFILIAL IN ('6', '20', '21', '22', '23')
          GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL = '6' THEN '20' ELSE M.CODFILIAL END
        )
        SELECT 
            V.CODPROD,
            V.CODFILIAL_MAPPED AS CODFILIAL,
            P.DESCRICAO,
            P.EMBALAGEM,
            P.UNIDADE,
            P.OBS2,
            F.RAZAOSOCIAL AS NOMEFILIAL,
            (
              SELECT SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0))
              FROM PCEST E
              WHERE E.CODPROD = V.CODPROD
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND E.CODFILIAL = V.CODFILIAL_MAPPED)
                )
            ) AS ESTOQUE_DISP,
            V.DIAS_COM_VENDA,
            V.DIAS_COM_VENDA_RECENTE,
            (
              SELECT MAX(M.DTMOV)
              FROM PCMOV M
              WHERE M.CODPROD = V.CODPROD
                AND M.CODOPER IN ('E', 'EB', 'EP')
                AND M.DTMOV >= TRUNC(SYSDATE) - 365
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND M.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND M.CODFILIAL = V.CODFILIAL_MAPPED)
                )
            ) AS DT_ULTIMA_ENTRADA,
            (
              SELECT NVL(SUM(NVL(I.QTPEDIDA, 0) - NVL(I.QTENTREGUE, 0)), 0)
              FROM PCITEM I
              JOIN PCPEDC P ON P.NUMPED = I.NUMPED
              WHERE I.CODPROD = V.CODPROD
                AND P.DTCANCEL IS NULL
                AND P.POSICAO <> 'C'
                AND P.DATA >= TRUNC(SYSDATE) - 60
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND P.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND P.CODFILIAL = V.CODFILIAL_MAPPED)
                )
            ) AS QT_PEDIDA_ABERTO
        FROM VENDAS V
        JOIN PCPRODUT P ON P.CODPROD = V.CODPROD
        LEFT JOIN PCFILIAL F ON F.CODIGO = V.CODFILIAL_MAPPED
        WHERE P.REVENDA = 'S'
          AND P.CODEPTO <> 6
          AND NVL(P.OBS2, ' ') <> 'FL'
          AND V.DIAS_COM_VENDA >= :minDiasComVenda
          AND V.DIAS_COM_VENDA_RECENTE >= 1
          AND (
              SELECT SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0))
              FROM PCEST E
              WHERE E.CODPROD = V.CODPROD
                AND (
                  (V.CODFILIAL_MAPPED = '20' AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (V.CODFILIAL_MAPPED <> '20' AND E.CODFILIAL = V.CODFILIAL_MAPPED)
                )
          ) <= :pisoEstoque
        ORDER BY V.CODFILIAL_MAPPED, V.DIAS_COM_VENDA DESC, P.DESCRICAO
        `;

        const result = await conn.execute(query, params, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        console.log(`Query finished in ${Date.now() - startTime}ms.`);
        console.log(`Total rows returned: ${result.rows.length}`);
        
        if (result.rows.length > 0) {
            console.log('Sample rupture products:');
            console.table(result.rows.slice(0, 15));
        } else {
            console.log('No rupture products found matching criteria.');
        }

    } catch (err) {
        console.error('Error during query:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
