require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const r = await conn.execute(
    `SELECT CODUSUR, NOME, CODSUPERVISOR, BLOQUEIO
     FROM PCUSUARI WHERE UPPER(NOME) LIKE '%DART%'
     ORDER BY NOME`, [], opt);
  console.table(r.rows);
  if (r.rows.length) {
    const cod = r.rows[0].CODUSUR;
    const f = await conn.execute(
      `SELECT CODFILIAL, COUNT(*) N, MAX(DTSAIDA) ULT FROM PCNFSAID
       WHERE CODUSUR=:c AND DTSAIDA>=TRUNC(SYSDATE)-60 GROUP BY CODFILIAL ORDER BY N DESC`, {c:cod}, opt);
    console.log(`Filiais de venda recentes do CODUSUR ${cod}:`); console.table(f.rows);
  }
  await conn.close(); await database.close();
})();
