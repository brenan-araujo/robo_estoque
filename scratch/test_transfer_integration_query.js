require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== TESTANDO QUERY DE INTEGRAÇÃO DE TRANSFERÊNCIAS ===');
        const query = `
        SELECT 
            T.NUMNOTA,
            T.NUMTRANSVENDA,
            T.CODFILIAL AS FILIAL_ORIGEM,
            FIL.FANTASIA AS FORNECEDOR,
            FIL.CODFORNEC AS CODFORNEC,
            CASE 
                WHEN T.CODCLI = 44487 THEN '20'
                WHEN T.CODCLI = 31992 THEN '6'
                WHEN T.CODCLI = 44775 THEN '21'
                WHEN T.CODCLI = 44577 THEN '22'
                WHEN T.CODCLI = 44575 THEN '23'
            END AS FILIAL_DESTINO,
            T.DTSAIDA AS PREV_ENTREGA,
            M.CODPROD,
            P.DESCRICAO AS DESCRICAO_PRODUTO,
            M.QT AS SALDO_PEDIDO,
            P.QTUNITCX,
            P.ALTURAM3,
            P.LARGURAM3,
            P.COMPRIMENTOM3,
            -- Estoque disponível no destino
            (
              SELECT NVL(SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0)), 0)
              FROM PCEST E
              WHERE E.CODPROD = M.CODPROD
                AND (
                  (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                     CASE 
                        WHEN T.CODCLI = 44775 THEN '21'
                        WHEN T.CODCLI = 44577 THEN '22'
                        WHEN T.CODCLI = 44575 THEN '23'
                     END
                  )
                )
            ) AS ESTOQUE_DISPONIVEL,
            -- Estoque bloqueado no destino
            (
              SELECT NVL(SUM(NVL(E.QTBLOQUEADA, 0)), 0)
              FROM PCEST E
              WHERE E.CODPROD = M.CODPROD
                AND (
                  (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                     CASE 
                        WHEN T.CODCLI = 44775 THEN '21'
                        WHEN T.CODCLI = 44577 THEN '22'
                        WHEN T.CODCLI = 44575 THEN '23'
                     END
                  )
                )
            ) AS ESTOQUE_BLOQUEADO,
            -- RUA no destino
            (
              SELECT NVL(MIN(CASE WHEN E.CODFILIAL = '20' THEN E.RUA END), MIN(E.RUA))
              FROM PCEST E
              WHERE E.CODPROD = M.CODPROD
                AND (
                  (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                     CASE 
                        WHEN T.CODCLI = 44775 THEN '21'
                        WHEN T.CODCLI = 44577 THEN '22'
                        WHEN T.CODCLI = 44575 THEN '23'
                     END
                  )
                )
            ) AS RUA,
            -- APTO no destino
            (
              SELECT NVL(MIN(CASE WHEN E.CODFILIAL = '20' THEN E.APTO END), MIN(E.APTO))
              FROM PCEST E
              WHERE E.CODPROD = M.CODPROD
                AND (
                  (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                     CASE 
                        WHEN T.CODCLI = 44775 THEN '21'
                        WHEN T.CODCLI = 44577 THEN '22'
                        WHEN T.CODCLI = 44575 THEN '23'
                     END
                  )
                )
            ) AS APARTAMENTO,
            P.NUMERO AS PREDIO
        FROM PCNFSAID T
        JOIN PCMOV M ON M.NUMTRANSVENDA = T.NUMTRANSVENDA AND M.CODOPER = 'S'
        JOIN PCPRODUT P ON M.CODPROD = P.CODPROD
        JOIN PCFILIAL FIL ON FIL.CODIGO = T.CODFILIAL
        LEFT JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
        WHERE T.DTCANCEL IS NULL
          AND E.NUMTRANSENT IS NULL
          AND T.CODFILIAL IN ('20', '6', '21', '22', '23')
          AND T.CODCLI IN (44487, 31992, 44775, 44577, 44575)
          AND NOT (T.CODFILIAL IN ('20', '6') AND T.CODCLI IN (44487, 31992))
        ORDER BY T.DTSAIDA DESC
        `;

        const res = await conn.execute(query, [], opt);
        console.log(`Encontrados ${res.rows.length} itens de transferências em trânsito.`);
        if (res.rows.length > 0) {
            console.table(res.rows);
        }

    } catch (err) {
        console.error('Erro na query:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
