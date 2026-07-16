require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // 1. Colunas da PCMETA
  const c = await conn.execute(
    `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCMETA' AND OWNER='BRAGO' ORDER BY COLUMN_ID`,[],opt);
  console.log('COLUNAS PCMETA:', c.rows.map(r=>r.COLUMN_NAME).join(', '));

  // 2. TIPOMETA usados pela RCA 93 em 2026
  const t = await conn.execute(
    `SELECT TIPOMETA, COUNT(*) N, MIN(DATA) DE, MAX(DATA) ATE
     FROM PCMETA WHERE CODUSUR=93 AND DATA>=TO_DATE('01/01/2026','DD/MM/YYYY')
     GROUP BY TIPOMETA ORDER BY N DESC`,[],opt);
  console.log('\nTIPOMETA RCA93 2026:'); console.table(t.rows);

  // 3. Linhas com CODFORNEC preenchido (julho e Q3)
  const f = await conn.execute(
    `SELECT TIPOMETA, CODFORNEC, DATA, VLVENDAPREV, MIXPREV
     FROM PCMETA WHERE CODUSUR=93 AND CODFORNEC IS NOT NULL
       AND DATA BETWEEN TO_DATE('01/06/2026','DD/MM/YYYY') AND TO_DATE('30/09/2026','DD/MM/YYYY')
     ORDER BY DATA, CODFORNEC FETCH FIRST 25 ROWS ONLY`,[],opt);
  console.log('\nLINHAS COM CODFORNEC (jun-set):'); console.table(f.rows);

  // 4. Contagem por mês das metas de fornecedor
  const m = await conn.execute(
    `SELECT TO_CHAR(DATA,'MM/YYYY') MES, COUNT(*) N, SUM(NVL(VLVENDAPREV,0)) TOTAL
     FROM PCMETA WHERE CODUSUR=93 AND CODFORNEC IS NOT NULL
       AND DATA>=TO_DATE('01/01/2026','DD/MM/YYYY')
     GROUP BY TO_CHAR(DATA,'MM/YYYY') ORDER BY MIN(DATA)`,[],opt);
  console.log('\nMETAS FORNEC POR MÊS (RCA93):'); console.table(m.rows);

  await conn.close(); await database.close();
})();
