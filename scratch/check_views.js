require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  const objs = [
    'VIEW_VENDAS_RESUMO_FATURAMENTO',
    'VIEW_DEVOL_RESUMO_FATURAMENTO',
    'FUNC_RESUMOFATURAMENTO'
  ];
  
  for (const o of objs) {
    try {
      if (o.startsWith('FUNC_')) {
        // Test function by calling it or checking if it exists in ALL_OBJECTS
        const r = await conn.execute(
          `SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OBJECT_NAME = :o`,
          { o }, opt
        );
        console.log(`FUNC ${o}:`, r.rows);
      } else {
        const r = await conn.execute(`SELECT COUNT(*) AS CNT FROM ${o} WHERE ROWNUM = 1`, {}, opt);
        console.log(`VIEW ${o}: OK, count row =`, r.rows);
      }
    } catch(e) {
      console.log(`FAIL ${o}:`, e.message.split('\n')[0]);
    }
  }
  
  await conn.close();
  await database.close();
})();
