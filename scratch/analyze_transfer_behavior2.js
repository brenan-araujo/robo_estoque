require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    const WHERE_BASE = `CODFILIALORIGEM IN ('20','6','21','22','23') AND CODFILIALDESTINO IN ('20','6','21','22','23')`;
    try {
        // Rotas reais (todas)
        console.log('===== VOLUME POR ROTA (últimos 180d, TODAS) =====');
        const rotas = await conn.execute(
            `SELECT CODFILIALORIGEM||' -> '||CODFILIALDESTINO AS ROTA,
                    COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS,
                    COUNT(*) AS LINHAS,
                    SUM(QTTRANSF) AS QTD_TOTAL,
                    SUM(CASE WHEN DTMOVTRANSF IS NULL THEN 1 ELSE 0 END) AS LINHAS_PENDENTES
             FROM PCTRANSFDEP
             WHERE DTTRANSF >= SYSDATE-180 AND ${WHERE_BASE}
             GROUP BY CODFILIALORIGEM||' -> '||CODFILIALDESTINO
             ORDER BY TRANSFS DESC`, [], opt);
        console.table(rotas.rows);

        // Tempo em trânsito por rota
        console.log('\n===== TEMPO EM TRÂNSITO (envio -> baixa) POR ROTA =====');
        const lag = await conn.execute(
            `SELECT CODFILIALORIGEM||' -> '||CODFILIALDESTINO AS ROTA,
                    COUNT(*) AS LINHAS_RECEBIDAS,
                    ROUND(AVG(DTMOVTRANSF - DTTRANSF),2) AS DIAS_MEDIO,
                    ROUND(MEDIAN(DTMOVTRANSF - DTTRANSF),1) AS DIAS_MEDIANA,
                    MIN(DTMOVTRANSF - DTTRANSF) AS DIAS_MIN,
                    MAX(DTMOVTRANSF - DTTRANSF) AS DIAS_MAX
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF IS NOT NULL AND DTTRANSF >= SYSDATE-180 AND ${WHERE_BASE}
             GROUP BY CODFILIALORIGEM||' -> '||CODFILIALDESTINO
             ORDER BY LINHAS_RECEBIDAS DESC`, [], opt);
        console.table(lag.rows);

        // Distribuição do lag (dias inteiros) - quão rápido a baixa acontece
        console.log('\n===== DISTRIBUIÇÃO DO TEMPO ATÉ A BAIXA (dias) =====');
        const lagDist = await conn.execute(
            `SELECT TRUNC(DTMOVTRANSF) - TRUNC(DTTRANSF) AS DIAS, COUNT(*) AS LINHAS,
                    ROUND(100*RATIO_TO_REPORT(COUNT(*)) OVER (),1) AS PCT
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF IS NOT NULL AND DTTRANSF >= SYSDATE-180 AND ${WHERE_BASE}
             GROUP BY TRUNC(DTMOVTRANSF) - TRUNC(DTTRANSF)
             ORDER BY DIAS`, [], opt);
        lagDist.rows.forEach(r => console.log(`  ${String(r.DIAS).padStart(3)} dia(s) | ${String(r.LINHAS).padStart(5)} linhas | ${r.PCT}%`));

        // Combinação dia-envio -> dia-baixa (heatmap textual) p/ par dominante
        console.log('\n===== FLUXO: DIA DO ENVIO -> DIA DA BAIXA (recebidas) =====');
        const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
        const flow = await conn.execute(
            `SELECT TO_CHAR(DTTRANSF,'D') AS D_ENVIO, TO_CHAR(DTMOVTRANSF,'D') AS D_BAIXA, COUNT(*) AS LINHAS
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF IS NOT NULL AND DTTRANSF >= SYSDATE-180 AND ${WHERE_BASE}
             GROUP BY TO_CHAR(DTTRANSF,'D'), TO_CHAR(DTMOVTRANSF,'D')
             ORDER BY D_ENVIO, D_BAIXA`, [], opt);
        flow.rows.forEach(r => console.log(`  Envio ${DIAS[Number(r.D_ENVIO)-1]} -> Baixa ${DIAS[Number(r.D_BAIXA)-1]} | ${r.LINHAS} linhas`));

        // Volume semanal recente (últimas 8 semanas)
        console.log('\n===== VOLUME SEMANAL (envio) - últimas 10 semanas =====');
        const sem = await conn.execute(
            `SELECT TO_CHAR(TRUNC(DTTRANSF,'IW'),'DD/MM') AS SEMANA,
                    COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS, COUNT(*) AS LINHAS
             FROM PCTRANSFDEP
             WHERE DTTRANSF >= SYSDATE-70 AND ${WHERE_BASE}
             GROUP BY TRUNC(DTTRANSF,'IW') ORDER BY TRUNC(DTTRANSF,'IW')`, [], opt);
        console.table(sem.rows);

    } catch (err) {
        console.error('ERRO:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
