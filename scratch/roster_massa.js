require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const r = await conn.execute(
    `SELECT U.CODUSUR, U.NOME, U.CODFILIAL, U.PSA_TELWHATS, U.TELEFONE1,
            (SELECT SUM(NVL(M.VLVENDAPREV,0)) FROM PCMETARCA M
              WHERE M.CODUSUR=U.CODUSUR
                AND M.DATA BETWEEN TRUNC(SYSDATE,'MM') AND LAST_DAY(SYSDATE)) META_MES
     FROM PCUSUARI U
     WHERE U.BLOQUEIO='N' AND U.CODUSUR NOT IN (100,400,401,402,403)
       AND EXISTS (SELECT 1 FROM PCMETARCA M WHERE M.CODUSUR=U.CODUSUR
                     AND M.DATA BETWEEN TRUNC(SYSDATE,'MM') AND LAST_DAY(SYSDATE)
                     AND NVL(M.VLVENDAPREV,0)>0)
     ORDER BY U.CODFILIAL, U.NOME`, [], opt);
  const norm = p => { let s=String(p||'').replace(/\D/g,''); if(s.length===10||s.length===11) s='55'+s; return s.length>=12?s:''; };
  let comFone=0, semFone=[];
  const porFil={};
  r.rows.forEach(x=>{
    const ph = norm(x.PSA_TELWHATS) || norm(x.TELEFONE1);
    porFil[x.CODFILIAL]=(porFil[x.CODFILIAL]||0)+1;
    if (ph) comFone++; else semFone.push(`${x.CODUSUR} ${x.NOME}`);
  });
  console.log(`Vendedores ativos com meta em julho: ${r.rows.length}`);
  console.log('Por filial:', porFil);
  console.log(`Com WhatsApp: ${comFone} | SEM telefone: ${semFone.length}`);
  if (semFone.length) console.log('Sem fone:', semFone.join(' | '));
  console.log('\nAmostra (5):');
  r.rows.slice(0,5).forEach(x=>console.log(`  ${x.CODUSUR} ${String(x.NOME).slice(0,25)} fil${x.CODFILIAL} meta=${x.META_MES} fone=${norm(x.PSA_TELWHATS)||norm(x.TELEFONE1)||'—'}`));
  await conn.close(); await database.close();
})();
