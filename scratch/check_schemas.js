require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  const schemas = ['', 'PCSIST.', 'PUBLIC.', 'PCSISTEMAS.'];
  const views = ['VIEW_VENDAS_RESUMO_FATURAMENTO', 'VIEW_DEVOL_RESUMO_FATURAMENTO'];
  
  for (const s of schemas) {
    for (const v of views) {
      const queryName = `${s}${v}`;
      try {
        const r = await conn.execute(`SELECT COUNT(*) AS CNT FROM ${queryName} WHERE ROWNUM = 1`, {}, opt);
        console.log(`SUCCESS ${queryName}: count =`, r.rows);
      } catch (e) {
        console.log(`FAIL ${queryName}:`, e.message.split('\n')[0]);
      }
    }
  }
  
  await conn.close();
  await database.close();
})();
