require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  const queries = {
    'Objects check': `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, STATUS FROM ALL_OBJECTS WHERE OBJECT_NAME LIKE '%RESUMO_FATURAMENTO%'`,
    'Synonyms check': `SELECT OWNER, SYNONYM_NAME, TABLE_OWNER, TABLE_NAME FROM ALL_SYNONYMS WHERE SYNONYM_NAME LIKE '%RESUMO_FATURAMENTO%'`,
    'Views check': `SELECT OWNER, VIEW_NAME FROM ALL_VIEWS WHERE VIEW_NAME LIKE '%RESUMO_FATURAMENTO%'`,
    'Privileges check': `SELECT OWNER, TABLE_NAME, PRIVILEGE, GRANTOR, GRANTEE FROM ALL_TAB_PRIVS WHERE TABLE_NAME LIKE '%RESUMO_FATURAMENTO%'`
  };
  
  for (const [label, sql] of Object.entries(queries)) {
    console.log(`\n=== ${label} ===`);
    try {
      const r = await conn.execute(sql, {}, opt);
      console.log(r.rows);
    } catch (e) {
      console.log('FAIL:', e.message.split('\n')[0]);
    }
  }
  
  await conn.close();
  await database.close();
})();
