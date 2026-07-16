require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];

// Regiões: 20 e 6 = DF (tratadas como uma só); 21=GO; 22=TO; 23=MS
// CODCLI das filiais destino: 44487->20(DF), 31992->6(DF), 44775->21(GO), 44577->22(TO), 44575->23(MS)
const REG_ORIGEM = `CASE T.CODFILIAL WHEN '20' THEN 'DF' WHEN '6' THEN 'DF' WHEN '21' THEN 'GO' WHEN '22' THEN 'TO' WHEN '23' THEN 'MS' END`;
const REG_DESTINO = `CASE T.CODCLI WHEN 44487 THEN 'DF' WHEN 31992 THEN 'DF' WHEN 44775 THEN 'GO' WHEN 44577 THEN 'TO' WHEN 44575 THEN 'MS' END`;
// Filtro base: NF de saída cujo cliente é uma filial alvo, origem é filial alvo, regiões diferentes, não cancelada
const BASE = `
  FROM PCNFSAID T
  WHERE T.DTCANCEL IS NULL
    AND T.CODFILIAL IN ('20','6','21','22','23')
    AND T.CODCLI IN (44487,31992,44775,44577,44575)
    AND ${REG_ORIGEM} <> ${REG_DESTINO}
    AND T.DTSAIDA >= SYSDATE-180`;

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    try {
        console.log('===== VOLUME POR ROTA (regiões, transf inter-filial, 180d) =====');
        const rotas = await conn.execute(
            `SELECT ${REG_ORIGEM}||' -> '||${REG_DESTINO} AS ROTA,
                    COUNT(DISTINCT T.NUMNOTA) AS NOTAS,
                    SUM(T.VLTOTAL) AS VALOR_TOTAL
             ${BASE}
             GROUP BY ${REG_ORIGEM}||' -> '||${REG_DESTINO}
             ORDER BY NOTAS DESC`, [], opt);
        console.table(rotas.rows);

        console.log('\n===== RESUMO POR ORIGEM e POR DESTINO =====');
        const porOrig = await conn.execute(
            `SELECT ${REG_ORIGEM} AS ORIGEM, COUNT(DISTINCT T.NUMNOTA) AS NOTAS ${BASE} GROUP BY ${REG_ORIGEM} ORDER BY NOTAS DESC`,[],opt);
        console.log('Por ORIGEM:'); console.table(porOrig.rows);
        const porDest = await conn.execute(
            `SELECT ${REG_DESTINO} AS DESTINO, COUNT(DISTINCT T.NUMNOTA) AS NOTAS ${BASE} GROUP BY ${REG_DESTINO} ORDER BY NOTAS DESC`,[],opt);
        console.log('Por DESTINO:'); console.table(porDest.rows);

        // Dia da semana: PEDIDO (PCPEDC.DATA), FATURAMENTO/SAIDA (DTSAIDA), ENTRADA DESTINO (PCNFENT.DTENT)
        console.log('\n===== DIA DA SEMANA - PEDIDO (PCPEDC.DATA) =====');
        const dowPed = await conn.execute(
            `SELECT TO_CHAR(P.DATA,'D') D, COUNT(DISTINCT T.NUMNOTA) N
             FROM PCNFSAID T JOIN PCPEDC P ON P.NUMTRANSVENDA = T.NUMTRANSVENDA
             WHERE T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
               AND T.CODCLI IN (44487,31992,44775,44577,44575)
               AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180
             GROUP BY TO_CHAR(P.DATA,'D') ORDER BY D`, [], opt);
        dowPed.rows.forEach(r=>console.log(`  ${DIAS[Number(r.D)-1]} | ${r.N}`));

        console.log('\n===== DIA DA SEMANA - SAIDA/ENVIO (DTSAIDA) =====');
        const dowSai = await conn.execute(
            `SELECT TO_CHAR(T.DTSAIDA,'D') D, COUNT(DISTINCT T.NUMNOTA) N ${BASE}
             GROUP BY TO_CHAR(T.DTSAIDA,'D') ORDER BY D`, [], opt);
        dowSai.rows.forEach(r=>console.log(`  ${DIAS[Number(r.D)-1]} | ${r.N}`));

        console.log('\n===== DIA DA SEMANA - ENTRADA NO DESTINO (PCNFENT.DTENT) =====');
        const dowEnt = await conn.execute(
            `SELECT TO_CHAR(E.DTENT,'D') D, COUNT(DISTINCT T.NUMNOTA) N
             FROM PCNFSAID T JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
             WHERE T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
               AND T.CODCLI IN (44487,31992,44775,44577,44575)
               AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180
             GROUP BY TO_CHAR(E.DTENT,'D') ORDER BY D`, [], opt);
        dowEnt.rows.forEach(r=>console.log(`  ${DIAS[Number(r.D)-1]} | ${r.N}`));

        console.log('\n===== DIA DA SEMANA - LANCAMENTO ENTRADA (PCNFENT.DTLANCTO = baixa real) =====');
        const dowLan = await conn.execute(
            `SELECT TO_CHAR(E.DTENT,'D') D, COUNT(DISTINCT T.NUMNOTA) N
             FROM PCNFSAID T JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
             WHERE T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
               AND T.CODCLI IN (44487,31992,44775,44577,44575)
               AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180 
             GROUP BY TO_CHAR(E.DTENT,'D') ORDER BY D`, [], opt);
        dowLan.rows.forEach(r=>console.log(`  ${DIAS[Number(r.D)-1]} | ${r.N}`));

        // Lags: pedido->saida e saida->entrada (DTLANCTO), por rota
        console.log('\n===== TEMPOS (dias) por ROTA =====');
        const lag = await conn.execute(
            `SELECT ${REG_ORIGEM}||' -> '||${REG_DESTINO} AS ROTA,
                    COUNT(*) AS NOTAS_COM_ENTRADA,
                    ROUND(AVG(TRUNC(T.DTSAIDA)-TRUNC(P.DATA)),1) AS PEDIDO_ATE_SAIDA,
                    ROUND(AVG(TRUNC(E.DTENT)-TRUNC(T.DTSAIDA)),1) AS SAIDA_ATE_BAIXA,
                    ROUND(AVG(TRUNC(E.DTENT)-TRUNC(P.DATA)),1) AS TOTAL_PEDIDO_BAIXA,
                    ROUND(MEDIAN(TRUNC(E.DTENT)-TRUNC(T.DTSAIDA)),1) AS MEDIANA_SAIDA_BAIXA
             FROM PCNFSAID T
             JOIN PCPEDC P ON P.NUMTRANSVENDA = T.NUMTRANSVENDA
             JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
             WHERE T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
               AND T.CODCLI IN (44487,31992,44775,44577,44575)
               AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180 
             GROUP BY ${REG_ORIGEM}||' -> '||${REG_DESTINO} ORDER BY NOTAS_COM_ENTRADA DESC`, [], opt);
        console.table(lag.rows);

        // Distribuição do lag saida->baixa
        console.log('\n===== DISTRIBUICAO SAIDA -> BAIXA NO DESTINO (dias) =====');
        const dist = await conn.execute(
            `SELECT TRUNC(E.DTENT)-TRUNC(T.DTSAIDA) AS DIAS, COUNT(*) N,
                    ROUND(100*RATIO_TO_REPORT(COUNT(*)) OVER (),1) PCT
             FROM PCNFSAID T JOIN PCNFENT E ON E.NUMTRANSVENDAORIG=T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
             WHERE T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
               AND T.CODCLI IN (44487,31992,44775,44577,44575)
               AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180 
             GROUP BY TRUNC(E.DTENT)-TRUNC(T.DTSAIDA) ORDER BY DIAS`, [], opt);
        dist.rows.forEach(r=>console.log(`  ${String(r.DIAS).padStart(3)} dia(s) | ${String(r.N).padStart(4)} | ${r.PCT}%`));

        // % com entrada registrada vs pendente
        console.log('\n===== COBERTURA: saídas com entrada no destino =====');
        const cob = await conn.execute(
            `SELECT COUNT(DISTINCT T.NUMNOTA) TOTAL_SAIDAS,
                    COUNT(DISTINCT CASE WHEN E.NUMTRANSENT IS NOT NULL THEN T.NUMNOTA END) COM_ENTRADA
             FROM PCNFSAID T LEFT JOIN PCNFENT E ON E.NUMTRANSVENDAORIG=T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
             WHERE T.DTCANCEL IS NULL AND T.CODFILIAL IN ('20','6','21','22','23')
               AND T.CODCLI IN (44487,31992,44775,44577,44575)
               AND ${REG_ORIGEM} <> ${REG_DESTINO} AND T.DTSAIDA >= SYSDATE-180`, [], opt);
        console.table(cob.rows);

    } catch (err) {
        console.error('ERRO:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
