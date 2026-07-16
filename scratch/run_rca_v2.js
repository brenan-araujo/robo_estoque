require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  let sql = fs.readFileSync(path.join(__dirname,'..','sql','relatorio_rca_metas.sql'),'utf8').replace(/;\s*$/,'').trim();
  // remove o join de MIX (função inacessível ao nosso usuário) e zera a coluna
  sql = sql.replace(/NVL\(MIX\.QTMIXPRODUTO, 0\) AS MIX_REALIZADO/, '0 AS MIX_REALIZADO');
  sql = sql.replace(/LEFT JOIN \(\s*-- \(4\)\(5\) MIX[\s\S]*?\) MIX ON BASE\.CODUSUR = MIX\.CODUSUR/, '');
  const binds = { DTINI:'01/06/2026', DTFIM:'30/06/2026', CODFILIAL:'20', CODUSUR:93, SUPERVISOR:2 };
  try {
    const r = await conn.execute(sql, binds, opt);
    console.log('Linhas:', r.rows.length);
    if (r.rows.length) console.dir(r.rows[0], { depth:null });
  } catch(e){ console.error('ERRO SQL principal:', e.message); }

  // MIX realizado direto (distinct produtos vendidos)
  try {
    const m = await conn.execute(
      `SELECT COUNT(DISTINCT M.CODPROD) MIX FROM PCMOV M
       WHERE M.CODUSUR=:c AND M.CODOPER='S' AND M.CODFILIAL IN ('20','6')
         AND M.DTMOV BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
      {c:93, di:'01/06/2026', df:'30/06/2026'}, opt);
    console.log('MIX_REALIZADO (distinct prod):', m.rows[0].MIX);
  } catch(e){ console.error('ERRO mix:', e.message); }
  await conn.close(); await database.close();
})();
