require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    // Regiões: 20 e 6 = DF; 21=GO; 22=TO; 23=MS
    // Mapeamento CODCLI -> Filial
    // 44487 -> 20, 31992 -> 6, 44775 -> 21, 44577 -> 22, 44575 -> 23
    const REG_ORIGEM = `CASE T.CODFILIAL WHEN '20' THEN 'DF' WHEN '6' THEN 'DF' WHEN '21' THEN 'GO' WHEN '22' THEN 'TO' WHEN '23' THEN 'MS' END`;
    const REG_DESTINO = `CASE T.CODCLI WHEN 44487 THEN 'DF' WHEN 31992 THEN 'DF' WHEN 44775 THEN 'GO' WHEN 44577 THEN 'TO' WHEN 44575 THEN 'MS' END`;

    try {
        console.log('=== BUSCANDO ITENS DE TRANSFERÊNCIA EM TRÂNSITO ===');
        const query = `
        SELECT 
            T.NUMNOTA,
            T.NUMTRANSVENDA,
            T.CODFILIAL AS FILIAL_ORIGEM,
            CASE 
                WHEN T.CODCLI = 44487 THEN '20'
                WHEN T.CODCLI = 31992 THEN '6'
                WHEN T.CODCLI = 44775 THEN '21'
                WHEN T.CODCLI = 44577 THEN '22'
                WHEN T.CODCLI = 44575 THEN '23'
            END AS FILIAL_DESTINO,
            T.DTSAIDA,
            T.DTFAT,
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
          AND T.CODCLI IN (44487, 31992, 44775, 44577, 44575)
          -- Excluir transferências internas DF CD (20) <-> DF Loja (6)
          AND NOT (T.CODFILIAL IN ('20', '6') AND T.CODCLI IN (44487, 31992))
        ORDER BY T.DTSAIDA ASC, T.NUMNOTA ASC, M.CODPROD ASC
        `;

        const res = await conn.execute(query, [], opt);
        console.log(`\nEncontrados ${res.rows.length} itens de transferência pendentes em trânsito.`);
        
        if (res.rows.length > 0) {
            console.log('\nPrimeiras 15 linhas de itens:');
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
