require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    try {
        // 0. Todas as colunas de PCTRANSFDEP (procurar campos de data/pedido)
        console.log('===== COLUNAS DE PCTRANSFDEP =====');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
             WHERE TABLE_NAME='PCTRANSFDEP' AND OWNER='BRAGO' ORDER BY COLUMN_ID`,
            [], opt);
        console.log(cols.rows.map(r => `${r.COLUMN_NAME}(${r.DATA_TYPE})`).join(', '));

        // 1. Visão geral: volume últimos 180 dias + % recebidas
        console.log('\n===== VISÃO GERAL (últimos 180 dias) =====');
        const overview = await conn.execute(
            `SELECT
                COUNT(*) AS LINHAS,
                COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFERENCIAS,
                COUNT(DISTINCT CODFILIALORIGEM||'>'||CODFILIALDESTINO) AS ROTAS,
                SUM(CASE WHEN DTMOVTRANSF IS NULL THEN 1 ELSE 0 END) AS LINHAS_EM_TRANSITO,
                SUM(CASE WHEN DTMOVTRANSF IS NOT NULL THEN 1 ELSE 0 END) AS LINHAS_RECEBIDAS
             FROM PCTRANSFDEP
             WHERE DTTRANSF >= SYSDATE-180
               AND CODFILIALORIGEM IN ('20','6','21','22','23')
               AND CODFILIALDESTINO IN ('20','6','21','22','23')`,
            [], opt);
        console.table(overview.rows);

        // 2. Distribuição por dia da semana do FATURAMENTO/ENVIO (DTTRANSF)
        console.log('\n===== DIA DA SEMANA DO ENVIO (DTTRANSF) - últimos 180d =====');
        const envioDow = await conn.execute(
            `SELECT TO_CHAR(DTTRANSF,'D') AS DOW, COUNT(*) AS LINHAS,
                    COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS
             FROM PCTRANSFDEP
             WHERE DTTRANSF >= SYSDATE-180
               AND CODFILIALORIGEM IN ('20','6','21','22','23')
               AND CODFILIALDESTINO IN ('20','6','21','22','23')
             GROUP BY TO_CHAR(DTTRANSF,'D') ORDER BY DOW`,
            [], opt);
        envioDow.rows.forEach(r => console.log(`  ${DIAS[Number(r.DOW)-1].padEnd(8)} | ${r.TRANSFS} transfs | ${r.LINHAS} linhas`));

        // 3. Distribuição por dia da semana da BAIXA/RECEBIMENTO (DTMOVTRANSF)
        console.log('\n===== DIA DA SEMANA DA BAIXA NO DESTINO (DTMOVTRANSF) - últimos 180d =====');
        const baixaDow = await conn.execute(
            `SELECT TO_CHAR(DTMOVTRANSF,'D') AS DOW, COUNT(*) AS LINHAS,
                    COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF >= SYSDATE-180
               AND CODFILIALORIGEM IN ('20','6','21','22','23')
               AND CODFILIALDESTINO IN ('20','6','21','22','23')
             GROUP BY TO_CHAR(DTMOVTRANSF,'D') ORDER BY DOW`,
            [], opt);
        baixaDow.rows.forEach(r => console.log(`  ${DIAS[Number(r.DOW)-1].padEnd(8)} | ${r.TRANSFS} transfs | ${r.LINHAS} linhas`));

        // 4. Tempo em trânsito (envio -> baixa) por rota, somente recebidas
        console.log('\n===== TEMPO MÉDIO EM TRÂNSITO POR ROTA (recebidas, últimos 180d) =====');
        const lag = await conn.execute(
            `SELECT CODFILIALORIGEM||' -> '||CODFILIALDESTINO AS ROTA,
                    COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS,
                    ROUND(AVG(DTMOVTRANSF - DTTRANSF),2) AS DIAS_MEDIO,
                    MIN(DTMOVTRANSF - DTTRANSF) AS DIAS_MIN,
                    MAX(DTMOVTRANSF - DTTRANSF) AS DIAS_MAX,
                    ROUND(MEDIAN(DTMOVTRANSF - DTTRANSF),1) AS DIAS_MEDIANA
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF IS NOT NULL AND DTTRANSF >= SYSDATE-180
               AND CODFILIALORIGEM IN ('20','6','21','22','23')
               AND CODFILIALDESTINO IN ('20','6','21','22','23')
               AND NOT (CODFILIALORIGEM IN ('20','6') AND CODFILIALDESTINO IN ('20','6'))
             GROUP BY CODFILIALORIGEM||' -> '||CODFILIALDESTINO
             ORDER BY TRANSFS DESC`,
            [], opt);
        console.table(lag.rows);

        // 5. Volume por rota
        console.log('\n===== VOLUME POR ROTA (últimos 180d) =====');
        const rotas = await conn.execute(
            `SELECT CODFILIALORIGEM||' -> '||CODFILIALDESTINO AS ROTA,
                    COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS,
                    COUNT(*) AS LINHAS,
                    SUM(QTTRANSF) AS QTD_TOTAL,
                    SUM(CASE WHEN DTMOVTRANSF IS NULL THEN 1 ELSE 0 END) AS LINHAS_PENDENTES
             FROM PCTRANSFDEP
             WHERE DTTRANSF >= SYSDATE-180
               AND CODFILIALORIGEM IN ('20','6','21','22','23')
               AND CODFILIALDESTINO IN ('20','6','21','22','23')
               AND NOT (CODFILIALORIGEM IN ('20','6') AND CODFILIALDESTINO IN ('20','6'))
             GROUP BY CODFILIALORIGEM||' -> '||CODFILIALDESTINO
             ORDER BY TRANSFS DESC`,
            [], opt);
        console.table(rotas.rows);

        // 6. Pendências antigas (em trânsito há muito tempo)
        console.log('\n===== PENDÊNCIAS EM TRÂNSITO - distribuição por idade =====');
        const aging = await conn.execute(
            `SELECT
                CASE WHEN SYSDATE-DTTRANSF <= 3 THEN '0-3 dias'
                     WHEN SYSDATE-DTTRANSF <= 7 THEN '4-7 dias'
                     WHEN SYSDATE-DTTRANSF <= 15 THEN '8-15 dias'
                     WHEN SYSDATE-DTTRANSF <= 30 THEN '16-30 dias'
                     ELSE '30+ dias' END AS FAIXA,
                COUNT(DISTINCT NUMTRANSVENDA) AS TRANSFS,
                COUNT(*) AS LINHAS
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF IS NULL
               AND CODFILIALORIGEM IN ('20','6','21','22','23')
               AND CODFILIALDESTINO IN ('20','6','21','22','23')
               AND NOT (CODFILIALORIGEM IN ('20','6') AND CODFILIALDESTINO IN ('20','6'))
             GROUP BY CASE WHEN SYSDATE-DTTRANSF <= 3 THEN '0-3 dias'
                     WHEN SYSDATE-DTTRANSF <= 7 THEN '4-7 dias'
                     WHEN SYSDATE-DTTRANSF <= 15 THEN '8-15 dias'
                     WHEN SYSDATE-DTTRANSF <= 30 THEN '16-30 dias'
                     ELSE '30+ dias' END
             ORDER BY 1`,
            [], opt);
        console.table(aging.rows);

    } catch (err) {
        console.error('ERRO:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
