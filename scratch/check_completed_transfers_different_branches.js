require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== BUSCANDO ITENS DE TRANSFERÊNCIA CONCLUÍDOS ENTRE REGIÕES DIFERENTES (180 DIAS) ===');
        const query = `
        SELECT 
            T.NUMNOTA,
            T.NUMTRANSVENDA,
            T.CODFILIAL AS FILIAL_ORIGEM,
            CASE 
                WHEN T.CODCLIFILIAL = 44487 THEN '20'
                WHEN T.CODCLIFILIAL = 31992 THEN '6'
                WHEN T.CODCLIFILIAL = 44775 THEN '21'
                WHEN T.CODCLIFILIAL = 44577 THEN '22'
                WHEN T.CODCLIFILIAL = 44575 THEN '23'
            END AS FILIAL_DESTINO,
            T.DTSAIDA,
            E.DTENT AS DTRECEBIMENTO,
            COUNT(DISTINCT M.CODPROD) AS ITENS,
            SUM(M.QT) AS QTD_TOTAL
        FROM PCNFSAID T
        JOIN PCMOV M ON M.NUMTRANSVENDA = T.NUMTRANSVENDA AND M.CODOPER = 'S'
        JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
        WHERE T.DTCANCEL IS NULL
          AND T.CODFILIAL IN ('20', '6', '21', '22', '23')
          AND T.CODCLIFILIAL IN (44487, 31992, 44775, 44577, 44575)
          -- Excluir transferências internas dentro da mesma região
          AND NOT (
              (T.CODFILIAL IN ('20', '6') AND T.CODCLIFILIAL IN (44487, 31992))
              OR (T.CODFILIAL = '21' AND T.CODCLIFILIAL = 44775)
              OR (T.CODFILIAL = '22' AND T.CODCLIFILIAL = 44577)
              OR (T.CODFILIAL = '23' AND T.CODCLIFILIAL = 44575)
          )
          AND T.DTSAIDA >= SYSDATE - 180
        GROUP BY T.NUMNOTA, T.NUMTRANSVENDA, T.CODFILIAL, T.CODCLIFILIAL, T.DTSAIDA, E.DTENT
        ORDER BY T.DTSAIDA DESC
        `;

        const res = await conn.execute(query, [], opt);
        console.log(`\nEncontrados ${res.rows.length} transferências inter-região concluídas.`);
        if (res.rows.length > 0) {
            console.table(res.rows.slice(0, 30));
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
