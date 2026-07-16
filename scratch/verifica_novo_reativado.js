require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const C=93, FIL='20', DI='01/06/2026', DF='30/06/2026';
  const rows = async (sql,b)=> (await conn.execute(sql,b,opt)).rows;

  const novos = await rows(
    `SELECT DISTINCT cl.codcli FROM pcclient cl
     JOIN pcmov pm ON pm.codcli=cl.codcli
     JOIN pcpedc pp ON pp.numped=pm.numped AND pp.dtcancel IS NULL AND pp.condvenda IN (1,7,9,14) AND pp.vltotal>=120
     WHERE pm.codoper='S' AND pm.codfilial=:fil AND pm.codusur=:c
       AND pm.dtmov BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
       AND NOT EXISTS (SELECT 1 FROM pcmov pm2 WHERE pm2.codcli=cl.codcli AND pm2.codoper='S' AND pm2.dtmov<TO_DATE(:di,'DD/MM/YYYY'))`,
    {c:C,fil:FIL,di:DI,df:DF});
  const resg = await rows(
    `SELECT DISTINCT PE.CODCLI FROM PCPEDC PE
     WHERE PE.CODUSUR=:c AND PE.CODFILIAL=:fil AND PE.DTCANCEL IS NULL AND PE.CONDVENDA IN (1,7,9,14) AND PE.POSICAO='F' AND PE.VLTOTAL>=120
       AND PE.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
       AND NOT EXISTS (SELECT 1 FROM PCPEDC P WHERE P.CODCLI=PE.CODCLI AND P.DTCANCEL IS NULL AND P.CONDVENDA IN (1,7,9,14) AND P.POSICAO='F'
            AND P.DATA BETWEEN ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6) AND ADD_MONTHS(TO_DATE(:df,'DD/MM/YYYY'),-1))`,
    {c:C,fil:FIL,di:DI,df:DF});

  const sn = new Set(novos.map(r=>r.CODCLI));
  const sr = new Set(resg.map(r=>r.CODCLI));
  const inter = [...sn].filter(x=>sr.has(x));
  console.log('NOVOS   :', [...sn]);
  console.log('RESGATE :', [...sr]);
  console.log('INTERSEÇÃO (contados nos dois):', inter);

  // Para cada cliente da interseção, mostrar 1ª compra de sempre
  for (const cc of inter) {
    const r = await rows(`SELECT MIN(DTMOV) PRIMEIRA FROM PCMOV WHERE CODCLI=:cc AND CODOPER='S'`, {cc});
    console.log(`  cliente ${cc}: 1ª compra de sempre = ${r[0].PRIMEIRA}`);
  }
  await conn.close(); await database.close();
})();
