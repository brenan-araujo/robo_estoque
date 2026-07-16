require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('Querying products to inspect descriptions...');
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
            P.DESCRICAO,
            F.RAZAOSOCIAL AS NOMEFILIAL
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
        `;

        const result = await conn.execute(query, params, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        console.log(`Total rows: ${result.rows.length}`);
        let nonAsciiCount = 0;
        
        result.rows.forEach(row => {
            const desc = row.DESCRICAO;
            const hasNonAscii = /[^\x00-\x7F]/.test(desc) || /[^\x00-\x7F]/.test(row.NOMEFILIAL);
            if (hasNonAscii) {
                nonAsciiCount++;
                console.log(`CODPROD: ${row.CODPROD} | DESC: ${desc} | NOMEFILIAL: ${row.NOMEFILIAL}`);
            }
        });
        
        console.log(`\nProducts with non-ASCII characters: ${nonAsciiCount}`);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
