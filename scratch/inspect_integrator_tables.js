require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  const tables = [
    'PCPEDCFV',
    'PCPEDIFV',
    'PCINTEGRARPEDIDOS',
    'PCINT_PEDIDO',
    'PCINT_PEDIDODET',
    'PCLOG_INTEGRADORA',
    'PCINTEGRACAOWTAC',
    'PCINTEGRACAOWTAI'
  ];
  
  for (const t of tables) {
    try {
      const countRes = await conn.execute(`SELECT COUNT(*) AS CNT FROM ${t}`, {}, opt);
      const cnt = countRes.rows[0].CNT;
      console.log(`Table ${t}: ${cnt} rows`);
      
      if (cnt > 0) {
        // Let's get some column names
        const colRes = await conn.execute(
          `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = :t AND OWNER = 'BRAGO' AND ROWNUM <= 8`,
          { t }, opt
        );
        const cols = colRes.rows.map(r => `${r.COLUMN_NAME} (${r.DATA_TYPE})`).join(', ');
        console.log(`  Sample Columns: ${cols}`);
        
        // Let's get 1 sample row
        const sampleRes = await conn.execute(`SELECT * FROM ${t} WHERE ROWNUM = 1`, {}, opt);
        console.log(`  Sample Row: ${JSON.stringify(sampleRes.rows[0])}`);
      }
    } catch (e) {
      console.log(`Table ${t}: FAIL ->`, e.message.split('\n')[0]);
    }
  }
  
  await conn.close();
  await database.close();
})();
