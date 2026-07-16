require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const objs = ['PCMETARCA','PCMETA','PCDIASUTEIS','PCMOVTRANSFRCA','VIEW_VENDAS_RESUMO_FATURAMENTO','VIEW_DEVOL_RESUMO_FATURAMENTO','PCNFSAID','PCMOV','PCPEDC'];
  for (const o of objs) {
    try { await conn.execute(`SELECT 1 FROM ${o} WHERE ROWNUM=1`); console.log('OK  ', o); }
    catch(e){ console.log('FALHA', o, '->', e.message.split('\n')[0]); }
  }
  // PCMETARCA colunas de meta p/ Darticleia em junho
  try {
    const r = await conn.execute(
      `SELECT SUM(NVL(VLVENDAPREV,0)) META_VENDA, SUM(NVL(QTPEDPREV,0)) META_ABERTURA, SUM(NVL(QTITENSPEDPREV,0)) META_REATIV
       FROM PCMETARCA WHERE CODUSUR=93 AND DATA BETWEEN TO_DATE('01/06/2026','DD/MM/YYYY') AND TO_DATE('30/06/2026','DD/MM/YYYY')`,
      [], {outFormat:oracledb.OUT_FORMAT_OBJECT});
    console.log('PCMETARCA metas Darticleia:', r.rows[0]);
  } catch(e){ console.log('PCMETARCA metas erro:', e.message); }
  // PCMETA colunas?
  try {
    const r = await conn.execute(
      `SELECT MAX(MIXPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) MIXPREV, MAX(CLIPOSPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) CLIPOSPREV
       FROM PCMETA WHERE CODUSUR=93 AND TIPOMETA='M' AND DATA BETWEEN TO_DATE('01/06/2026','DD/MM/YYYY') AND TO_DATE('30/06/2026','DD/MM/YYYY')`,
      [], {outFormat:oracledb.OUT_FORMAT_OBJECT});
    console.log('PCMETA mix/clipos Darticleia:', r.rows[0]);
  } catch(e){ console.log('PCMETA erro:', e.message); }
  await conn.close(); await database.close();
})();
