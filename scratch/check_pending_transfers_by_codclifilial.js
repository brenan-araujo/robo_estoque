require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== BUSCANDO ITENS DE TRANSFERÊNCIA EM TRÂNSITO VIA CODCLIFILIAL ===');
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
            M.CODPROD,
            P.DESCRICAO AS DESCRICAO_PRODUTO,
            M.QT,
            P.QTUNITCX,
            P.ALTURAM3,
            P.LARGURAM3,
            P.COMPRIMENTOM3
        FROM PCNFSAID T
        JOIN PCMOV M ON M.NUMTRANSVENDA = T.NUMTRANSVENDA AND M.CODOPER = 'S'
        JOIN PCPRODUT P ON M.CODPROD = P.CODPROD
        LEFT JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
        WHERE T.DTCANCEL IS NULL
          AND E.NUMTRANSENT IS NULL
          AND T.CODFILIAL IN ('20', '6', '21', '22', '23')
          AND T.CODCLIFILIAL IN (44487, 31992, 44775, 44577, 44575)
          -- Excluir transferências internas DF (20/6) <-> DF (20/6)
          AND NOT (T.CODFILIAL IN ('20', '6') AND T.CODCLIFILIAL IN (44487, 31992))
        ORDER BY T.DTSAIDA ASC, T.NUMNOTA ASC, M.CODPROD ASC
        `;

        const res = await conn.execute(query, [], opt);
        console.log(`\nEncontrados ${res.rows.length} itens de transferência em trânsito.`);
        if (res.rows.length > 0) {
            console.table(res.rows.slice(0, 20));
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
