require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // Meta mensal do Albino nos últimos meses (PCMETARCA é diária -> soma por mês)
  const m = await conn.execute(
    `SELECT TO_CHAR(DATA,'MM/YYYY') MES, COUNT(*) DIAS_LANCADOS,
            SUM(NVL(VLVENDAPREV,0)) META_MES,
            ROUND(AVG(NVL(VLVENDAPREV,0)),2) MEDIA_DIA,
            MIN(DATA) DE, MAX(DATA) ATE
     FROM PCMETARCA WHERE CODUSUR=3
       AND DATA >= TO_DATE('01/03/2026','DD/MM/YYYY')
     GROUP BY TO_CHAR(DATA,'MM/YYYY') ORDER BY MIN(DATA)`, [], opt);
  console.log('ALBINO VALADAO (RCA 3) — metas por mês:');
  console.table(m.rows);

  // Realizado dele nos meses anteriores (p/ contexto)
  const v = await conn.execute(
    `SELECT TO_CHAR(DTSAIDA,'MM/YYYY') MES, ROUND(SUM(VLTOTAL),2) VENDA_BRUTA
     FROM PCNFSAID WHERE CODUSUR=3 AND CODFILIAL='20' AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14)
       AND DTSAIDA >= TO_DATE('01/03/2026','DD/MM/YYYY')
     GROUP BY TO_CHAR(DTSAIDA,'MM/YYYY') ORDER BY MIN(DTSAIDA)`, [], opt);
  console.log('Venda bruta por mês (fil 20):');
  console.table(v.rows);

  await conn.close(); await database.close();
})();
