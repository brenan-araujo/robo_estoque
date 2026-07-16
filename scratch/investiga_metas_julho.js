require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // 1. Metas de JULHO lançadas para RCA 93?
  const m = await conn.execute(
    `SELECT COUNT(*) N, SUM(NVL(VLVENDAPREV,0)) MV, SUM(NVL(QTPEDPREV,0)) MA, SUM(NVL(QTITENSPEDPREV,0)) MR,
            MIN(DATA) DE, MAX(DATA) ATE
     FROM PCMETARCA WHERE CODUSUR=93 AND DATA BETWEEN TO_DATE('01/07/2026','DD/MM/YYYY') AND TO_DATE('31/07/2026','DD/MM/YYYY')`,[],opt);
  console.log('PCMETARCA julho RCA93:', m.rows[0]);

  const mm = await conn.execute(
    `SELECT MAX(MIXPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) MIX, MAX(CLIPOSPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) POS
     FROM PCMETA WHERE CODUSUR=93 AND TIPOMETA='M' AND DATA BETWEEN TO_DATE('01/07/2026','DD/MM/YYYY') AND TO_DATE('31/07/2026','DD/MM/YYYY')`,[],opt);
  console.log('PCMETA (mix/pos) julho RCA93:', mm.rows[0]);

  // 2. Meta da SEMANA corrente (29/06 a 03/07) - soma diária
  const ms = await conn.execute(
    `SELECT SUM(NVL(VLVENDAPREV,0)) MSEM FROM PCMETARCA WHERE CODUSUR=93
       AND DATA BETWEEN TO_DATE('29/06/2026','DD/MM/YYYY') AND TO_DATE('03/07/2026','DD/MM/YYYY')`,[],opt);
  console.log('Meta semana 29/06-03/07:', ms.rows[0]);

  // 3. Dias úteis julho filial 20
  const d = await conn.execute(
    `SELECT COUNT(*) TOT,
            SUM(CASE WHEN DATA < TRUNC(SYSDATE) THEN 1 ELSE 0 END) DEC
     FROM PCDIASUTEIS WHERE DIAVENDAS='S' AND CODFILIAL='20'
       AND DATA BETWEEN TO_DATE('01/07/2026','DD/MM/YYYY') AND TO_DATE('31/07/2026','DD/MM/YYYY')`,[],opt);
  console.log('Dias úteis julho fil20:', d.rows[0]);

  // 4. Tabelas de meta por FORNECEDOR (p/ mês 3 do trimestre)
  const t = await conn.execute(
    `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER='BRAGO' AND TABLE_NAME LIKE '%META%' ORDER BY TABLE_NAME`,[],opt);
  console.log('Tabelas %META%:', t.rows.map(r=>r.TABLE_NAME).join(', '));

  await conn.close(); await database.close();
})();
