require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const r = await conn.execute(
    `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCNFSAID' AND OWNER='BRAGO' AND DATA_TYPE='DATE' ORDER BY COLUMN_ID`,[],opt);
  console.log('DATAS PCNFSAID:', r.rows.map(x=>x.COLUMN_NAME).join(', '));
  await conn.close(); await database.close();
})();
