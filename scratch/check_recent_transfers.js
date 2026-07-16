require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== BUSCANDO TRANSFERÊNCIAS RECENTES CONCLUÍDAS (ÚLTIMOS 60 DIAS) ===');
        const query = `
        SELECT 
            T.NUMNOTA,
            T.CODFILIAL AS ORIGEM,
            CASE 
                WHEN T.CODCLI = 44487 THEN '20'
                WHEN T.CODCLI = 31992 THEN '6'
                WHEN T.CODCLI = 44775 THEN '21'
                WHEN T.CODCLI = 44577 THEN '22'
                WHEN T.CODCLI = 44575 THEN '23'
            END AS DESTINO,
            T.DTSAIDA,
            E.DTENT AS DTRECEBIMENTO,
            COUNT(DISTINCT M.CODPROD) AS ITENS,
            SUM(M.QT) AS QTD_TOTAL
        FROM PCNFSAID T
        JOIN PCMOV M ON M.NUMTRANSVENDA = T.NUMTRANSVENDA AND M.CODOPER = 'S'
        JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
        WHERE T.DTCANCEL IS NULL
          AND T.CODFILIAL IN ('20', '6', '21', '22', '23')
          AND T.CODCLI IN (44487, 31992, 44775, 44577, 44575)
          AND NOT (T.CODFILIAL IN ('20', '6') AND T.CODCLI IN (44487, 31992))
          AND T.DTSAIDA >= SYSDATE - 60
        GROUP BY T.NUMNOTA, T.CODFILIAL, T.CODCLI, T.DTSAIDA, E.DTENT
        ORDER BY T.DTSAIDA DESC
        `;

        const res = await conn.execute(query, [], opt);
        console.log(`\nEncontradas ${res.rows.length} transferências concluídas.`);
        if (res.rows.length > 0) {
            console.table(res.rows.slice(0, 15));
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
