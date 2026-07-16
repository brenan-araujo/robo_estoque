require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

const REG_ORIGEM = `CASE T.CODFILIAL WHEN '20' THEN 'DF' WHEN '6' THEN 'DF' WHEN '21' THEN 'GO' WHEN '22' THEN 'TO' WHEN '23' THEN 'MS' END`;
const REG_DESTINO = `CASE T.CODCLI WHEN 44487 THEN 'DF' WHEN 31992 THEN 'DF' WHEN 44775 THEN 'GO' WHEN 44577 THEN 'TO' WHEN 44575 THEN 'MS' END`;
const W = `T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
   AND T.CODCLI IN (44487,31992,44775,44577,44575)
   AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180`;

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    try {
        console.log('===== PERCENTIS POR ROTA =====');
        const q = await conn.execute(
            `SELECT ROTA, N,
              P_ENV_P50, P_ENV_P75, P_ENV_P90,
              B_P50, B_P75, B_P90, B_MAX,
              T_P75, T_P90
             FROM (
               SELECT ${REG_ORIGEM}||' -> '||${REG_DESTINO} AS ROTA,
                 COUNT(*) AS N,
                 ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY TRUNC(T.DTSAIDA)-TRUNC(P.DATA)),1) AS P_ENV_P50,
                 ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY TRUNC(T.DTSAIDA)-TRUNC(P.DATA)),1) AS P_ENV_P75,
                 ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY TRUNC(T.DTSAIDA)-TRUNC(P.DATA)),1) AS P_ENV_P90,
                 ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY TRUNC(E.DTENT)-TRUNC(T.DTSAIDA)),1) AS B_P50,
                 ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY TRUNC(E.DTENT)-TRUNC(T.DTSAIDA)),1) AS B_P75,
                 ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY TRUNC(E.DTENT)-TRUNC(T.DTSAIDA)),1) AS B_P90,
                 MAX(TRUNC(E.DTENT)-TRUNC(T.DTSAIDA)) AS B_MAX,
                 ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY TRUNC(E.DTENT)-TRUNC(P.DATA)),1) AS T_P75,
                 ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY TRUNC(E.DTENT)-TRUNC(P.DATA)),1) AS T_P90
               FROM PCNFSAID T
               JOIN PCPEDC P ON P.NUMTRANSVENDA = T.NUMTRANSVENDA
               JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
               WHERE ${W}
               GROUP BY ${REG_ORIGEM}||' -> '||${REG_DESTINO}
             ) ORDER BY N DESC`, [], opt);
        console.table(q.rows);
        console.log('\nLegenda: P_ENV=pedido->envio (dias), B=envio->baixa, T=pedido->baixa total. P50/75/90=percentis.');
    } catch (err) {
        console.error('ERRO:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
