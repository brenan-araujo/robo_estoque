require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  let sql = fs.readFileSync(path.join(__dirname,'..','sql','relatorio_rca_metas.sql'),'utf8');
  sql = sql.replace(/;\s*$/,'').trim();
  const binds = {
    DTINI: '01/06/2026', DTFIM: '30/06/2026',
    CODFILIAL: '20', CODUSUR: 93, SUPERVISOR: 2
  };
  try {
    const r = await conn.execute(sql, binds, opt);
    console.log('Linhas:', r.rows.length);
    if (r.rows.length) console.dir(r.rows[0], { depth:null });
  } catch(e){ console.error('ERRO SQL:', e.message); }
  finally { await conn.close(); await database.close(); }
})();
