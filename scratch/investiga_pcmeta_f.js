require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // Amostra TIPOMETA='F' julho RCA93
  const s = await conn.execute(
    `SELECT CODIGO, CODIGO2, CODMETAC, CODFILIAL, DATA, VLVENDAPREV, MIXPREV
     FROM PCMETA WHERE CODUSUR=93 AND TIPOMETA='F'
       AND DATA BETWEEN TO_DATE('01/07/2026','DD/MM/YYYY') AND TO_DATE('31/07/2026','DD/MM/YYYY')
     ORDER BY VLVENDAPREV DESC FETCH FIRST 12 ROWS ONLY`,[],opt);
  console.log('TIPOMETA=F julho RCA93 (top por meta):'); console.table(s.rows);

  // CODIGO = CODFORNEC? testar join
  const j = await conn.execute(
    `SELECT M.CODIGO, F.FANTASIA, COUNT(*) N, SUM(NVL(M.VLVENDAPREV,0)) META
     FROM PCMETA M LEFT JOIN PCFORNEC F ON F.CODFORNEC = M.CODIGO
     WHERE M.CODUSUR=93 AND M.TIPOMETA='F'
       AND M.DATA BETWEEN TO_DATE('01/07/2026','DD/MM/YYYY') AND TO_DATE('31/07/2026','DD/MM/YYYY')
     GROUP BY M.CODIGO, F.FANTASIA ORDER BY META DESC FETCH FIRST 15 ROWS ONLY`,[],opt);
  console.log('\nJOIN CODIGO->PCFORNEC (julho):'); console.table(j.rows);

  // quantos fornecedores distintos e datas (mensal? diária?)
  const d = await conn.execute(
    `SELECT COUNT(DISTINCT CODIGO) FORNECS, COUNT(DISTINCT DATA) DATAS, MIN(DATA) DE, MAX(DATA) ATE
     FROM PCMETA WHERE CODUSUR=93 AND TIPOMETA='F'
       AND DATA BETWEEN TO_DATE('01/07/2026','DD/MM/YYYY') AND TO_DATE('31/07/2026','DD/MM/YYYY')`,[],opt);
  console.log('\nResumo julho:'); console.table(d.rows);

  await conn.close(); await database.close();
})();
