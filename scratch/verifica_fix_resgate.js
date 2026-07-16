require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const C=93, FIL='20', DI='01/06/2026', DF='30/06/2026';
  // RESGATE corrigido: exige compra ANTES da janela de inatividade (já era cliente)
  const r = await conn.execute(
    `SELECT DISTINCT PE.CODCLI FROM PCPEDC PE
     WHERE PE.CODUSUR=:c AND PE.CODFILIAL=:fil AND PE.DTCANCEL IS NULL AND PE.CONDVENDA IN (1,7,9,14) AND PE.POSICAO='F' AND PE.VLTOTAL>=120
       AND PE.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
       AND NOT EXISTS (SELECT 1 FROM PCPEDC P WHERE P.CODCLI=PE.CODCLI AND P.DTCANCEL IS NULL AND P.CONDVENDA IN (1,7,9,14) AND P.POSICAO='F'
            AND P.DATA BETWEEN ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6) AND ADD_MONTHS(TO_DATE(:df,'DD/MM/YYYY'),-1))
       AND EXISTS (SELECT 1 FROM PCPEDC P3 WHERE P3.CODCLI=PE.CODCLI AND P3.DTCANCEL IS NULL AND P3.CONDVENDA IN (1,7,9,14) AND P3.POSICAO='F'
            AND P3.DATA < ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6))`,
    {c:C,fil:FIL,di:DI,df:DF}, opt);
  console.log('RESGATE corrigido (exclui novos):', r.rows.map(x=>x.CODCLI), '=> total', r.rows.length);
  await conn.close(); await database.close();
})();
