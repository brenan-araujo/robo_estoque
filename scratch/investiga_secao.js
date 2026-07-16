require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // PCPRODUT tem CODSEC? colunas relacionadas a seção
  console.log('=== colunas de seção em PCPRODUT ===');
  const c = await conn.execute(
    `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCPRODUT' AND OWNER='BRAGO'
       AND (UPPER(COLUMN_NAME) LIKE '%SEC%' OR UPPER(COLUMN_NAME) LIKE '%DEPTO%' OR UPPER(COLUMN_NAME) LIKE '%CATEG%')
     ORDER BY COLUMN_ID`,[],opt);
  console.log(c.rows.map(r=>r.COLUMN_NAME).join(', '));

  // PCSECAO existe? procurar PERSONALIZACAO
  console.log('\n=== PCSECAO com PERSONALIZACAO ===');
  try {
    const s = await conn.execute(
      `SELECT CODSEC, DESCRICAO, CODEPTO FROM PCSECAO WHERE UPPER(DESCRICAO) LIKE '%PERSONALIZ%' ORDER BY CODSEC`,[],opt);
    console.table(s.rows);
  } catch(e){ console.log('PCSECAO erro:', e.message); }

  // Caso os códigos 10000,20,14,24,17 sejam CODSEC, ver descrição
  console.log('\n=== PCSECAO códigos 10000,20,14,24,17 ===');
  try {
    const s2 = await conn.execute(
      `SELECT CODSEC, DESCRICAO, CODEPTO FROM PCSECAO WHERE CODSEC IN (10000,20,14,24,17) ORDER BY CODSEC`,[],opt);
    console.table(s2.rows);
  } catch(e){ console.log('erro:', e.message); }

  await conn.close(); await database.close();
})();
