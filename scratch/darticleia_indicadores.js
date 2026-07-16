require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const C=93, FIL='20', DI='01/06/2026', DF='30/06/2026';
  const one = async (sql,binds)=> (await conn.execute(sql,binds,opt)).rows[0];

  const meta = await one(
    `SELECT SUM(NVL(VLVENDAPREV,0)) MV, SUM(NVL(QTPEDPREV,0)) MA, SUM(NVL(QTITENSPEDPREV,0)) MR
     FROM PCMETARCA WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`, {c:C,di:DI,df:DF});
  const metaM = await one(
    `SELECT MAX(MIXPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) MIX, MAX(CLIPOSPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) POS
     FROM PCMETA WHERE CODUSUR=:c AND TIPOMETA='M' AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`, {c:C,di:DI,df:DF});
  const vb = await one(
    `SELECT NVL(SUM(VLTOTAL),0) BRUTO FROM PCNFSAID
     WHERE CODUSUR=:c AND CODFILIAL=:fil AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14)
       AND DTSAIDA>=TO_DATE(:di,'DD/MM/YYYY') AND DTSAIDA<TO_DATE(:df,'DD/MM/YYYY')+1`, {c:C,fil:FIL,di:DI,df:DF});
  const dv = await one(
    `SELECT NVL(SUM(QT*PUNIT),0) DEVOL FROM PCMOV
     WHERE CODUSUR=:c AND CODFILIAL=:fil AND CODOPER='ED'
       AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`, {c:C,fil:FIL,di:DI,df:DF});
  const liq = Number(vb.BRUTO)-Number(dv.DEVOL);
  const pos = await one(
    `SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC
     WHERE CODUSUR=:c AND CODFILIAL=:fil AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14)
       AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`, {c:C,fil:FIL,di:DI,df:DF});
  const nov = await one(
    `SELECT COUNT(DISTINCT cl.codcli) N FROM pcclient cl
     JOIN pcmov pm ON pm.codcli=cl.codcli
     JOIN pcpedc pp ON pp.numped=pm.numped AND pp.dtcancel IS NULL AND pp.condvenda IN (1,7,9,14) AND pp.vltotal>=120
     WHERE pm.codoper='S' AND pm.codfilial=:fil AND pm.codusur=:c
       AND pm.dtmov BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
       AND NOT EXISTS (SELECT 1 FROM pcmov pm2 WHERE pm2.codcli=cl.codcli AND pm2.codoper='S' AND pm2.dtmov<TO_DATE(:di,'DD/MM/YYYY'))`, {c:C,fil:FIL,di:DI,df:DF});
  const res = await one(
    `SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC PE
     WHERE PE.CODUSUR=:c AND PE.CODFILIAL=:fil AND PE.DTCANCEL IS NULL AND PE.CONDVENDA IN (1,7,9,14) AND PE.POSICAO='F' AND PE.VLTOTAL>=120
       AND PE.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
       AND NOT EXISTS (SELECT 1 FROM PCPEDC P WHERE P.CODCLI=PE.CODCLI AND P.DTCANCEL IS NULL AND P.CONDVENDA IN (1,7,9,14) AND P.POSICAO='F'
            AND P.DATA BETWEEN ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6) AND ADD_MONTHS(TO_DATE(:df,'DD/MM/YYYY'),-1))`, {c:C,fil:FIL,di:DI,df:DF});
  const mix = await one(
    `SELECT COUNT(DISTINCT CODPROD) N FROM PCMOV
     WHERE CODUSUR=:c AND CODFILIAL=:fil AND CODOPER='S'
       AND DTMOV BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`, {c:C,fil:FIL,di:DI,df:DF});

  const out = {
    META_VENDA:Number(meta.MV), BRUTO:Number(vb.BRUTO), DEVOL:Number(dv.DEVOL), LIQUIDA:liq,
    META_POS:Number(metaM.POS), POS_REAL:Number(pos.N),
    META_ABERT:Number(meta.MA), ABERT_REAL:Number(nov.N),
    META_REAT:Number(meta.MR), REAT_REAL:Number(res.N),
    META_MIX:Number(metaM.MIX), MIX_REAL:Number(mix.N)
  };
  console.log(JSON.stringify(out,null,2));
  await conn.close(); await database.close();
})();
