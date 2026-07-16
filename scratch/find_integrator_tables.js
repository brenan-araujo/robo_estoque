require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  const terms = ['%ION%', '%INTEG%', '%IMPORT%', '%WTA%', '%FORCA%', '%PED%'];
  
  for (const t of terms) {
    try {
      console.log(`\n--- Searching tables matching: ${t} ---`);
      const r = await conn.execute(
        `SELECT OWNER, TABLE_NAME FROM ALL_TABLES WHERE TABLE_NAME LIKE :t AND OWNER NOT IN ('SYS', 'SYSTEM') ORDER BY TABLE_NAME`,
        { t }, opt
      );
      if (r.rows.length === 0) {
        console.log('No tables found.');
      } else {
        r.rows.forEach(row => {
          console.log(`  ${row.OWNER}.${row.TABLE_NAME}`);
        });
      }
    } catch (e) {
      console.error('FAIL:', e.message.split('\n')[0]);
    }
  }
  
  await conn.close();
  await database.close();
})();
