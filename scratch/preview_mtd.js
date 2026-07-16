require('dotenv').config();
const http = require('http');
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
const C=93, FIL='20', DI='01/06/2026', META_DF='30/06/2026', REAL_DF='26/06/2026';
const LABEL='Junho/2026 — acumulado até 26/06 (sexta)';
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const one=async(sql,b)=>(await conn.execute(sql,b,opt)).rows[0];
  // METAS (mês cheio)
  const meta=await one(`SELECT SUM(NVL(VLVENDAPREV,0)) MV,SUM(NVL(QTPEDPREV,0)) MA,SUM(NVL(QTITENSPEDPREV,0)) MR
     FROM PCMETARCA WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,{c:C,di:DI,df:META_DF});
  const metaM=await one(`SELECT MAX(MIXPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) MIX,MAX(CLIPOSPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) POS
     FROM PCMETA WHERE CODUSUR=:c AND TIPOMETA='M' AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,{c:C,di:DI,df:META_DF});
  // REALIZADO (acumulado até a sexta)
  const R={c:C,fil:FIL,di:DI,df:REAL_DF};
  const vb=await one(`SELECT NVL(SUM(VLTOTAL),0) B FROM PCNFSAID WHERE CODUSUR=:c AND CODFILIAL=:fil AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14) AND DTSAIDA>=TO_DATE(:di,'DD/MM/YYYY') AND DTSAIDA<TO_DATE(:df,'DD/MM/YYYY')+1`,R);
  const dv=await one(`SELECT NVL(SUM(QT*PUNIT),0) D FROM PCMOV WHERE CODUSUR=:c AND CODFILIAL=:fil AND CODOPER='ED' AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`,R);
  const liq=Number(vb.B)-Number(dv.D);
  const pos=await one(`SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC WHERE CODUSUR=:c AND CODFILIAL=:fil AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14) AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,R);
  const nov=await one(`SELECT COUNT(DISTINCT cl.codcli) N FROM pcclient cl JOIN pcmov pm ON pm.codcli=cl.codcli JOIN pcpedc pp ON pp.numped=pm.numped AND pp.dtcancel IS NULL AND pp.condvenda IN (1,7,9,14) AND pp.vltotal>=120 WHERE pm.codoper='S' AND pm.codfilial=:fil AND pm.codusur=:c AND pm.dtmov BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY') AND NOT EXISTS (SELECT 1 FROM pcmov pm2 WHERE pm2.codcli=cl.codcli AND pm2.codoper='S' AND pm2.dtmov<TO_DATE(:di,'DD/MM/YYYY'))`,R);
  const res=await one(`SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC PE WHERE PE.CODUSUR=:c AND PE.CODFILIAL=:fil AND PE.DTCANCEL IS NULL AND PE.CONDVENDA IN (1,7,9,14) AND PE.POSICAO='F' AND PE.VLTOTAL>=120 AND PE.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY') AND NOT EXISTS (SELECT 1 FROM PCPEDC P WHERE P.CODCLI=PE.CODCLI AND P.DTCANCEL IS NULL AND P.CONDVENDA IN (1,7,9,14) AND P.POSICAO='F' AND P.DATA BETWEEN ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6) AND ADD_MONTHS(TO_DATE(:df,'DD/MM/YYYY'),-1)) AND EXISTS (SELECT 1 FROM PCPEDC P3 WHERE P3.CODCLI=PE.CODCLI AND P3.DTCANCEL IS NULL AND P3.CONDVENDA IN (1,7,9,14) AND P3.POSICAO='F' AND P3.DATA < ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6))`,R);
  const mix=await one(`SELECT COUNT(DISTINCT CODPROD) N FROM PCMOV WHERE CODUSUR=:c AND CODFILIAL=:fil AND CODOPER='S' AND DTMOV BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,R);
  await conn.close(); await database.close();

  const d={metaVenda:Number(meta.MV),liquida:liq,metaPos:Number(metaM.POS)||0,posReal:Number(pos.N),metaAbert:Number(meta.MA),abertReal:Number(nov.N),metaReat:Number(meta.MR),reatReal:Number(res.N),metaMix:Number(metaM.MIX)||0,mixReal:Number(mix.N)};
  const brl=n=>'R$ '+Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const f1=n=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
  const pct=(r,m)=>m>0?(r/m*100):0; const sgn=n=>(n>=0?'+':'')+(Number.isInteger(n)?n:f1(n));
  const difV=d.liquida-d.metaVenda;
  const msg=
`📊 *Acompanhamento Semanal de Metas*
👤 *DARTICLEIA ABREU*  (RCA 93 · Filial 20)
🗓️ ${LABEL}

*━━ META QUANTITATIVA ━━*
💰 *Venda Líquida*
• Meta (mês): ${brl(d.metaVenda)}
• Realizado: ${brl(d.liquida)}
• Diferença: ${difV>=0?'+':'-'}${brl(Math.abs(difV))}
• Resultado: *${f1(pct(d.liquida,d.metaVenda))}%*

*━━ METAS QUALITATIVAS ━━*
✅ *Positivação*
• Meta: ${d.metaPos} | Realizado: ${d.posReal} | Dif: ${sgn(d.posReal-d.metaPos)} | Resultado: *${f1(pct(d.posReal,d.metaPos))}%*

🆕 *Abertura (novos clientes)*
• Meta: ${d.metaAbert} | Realizado: ${d.abertReal} | Dif: ${sgn(d.abertReal-d.metaAbert)} | Resultado: *${f1(pct(d.abertReal,d.metaAbert))}%*

🔄 *Reativação*
• Meta: ${d.metaReat} | Realizado: ${d.reatReal} | Dif: ${sgn(d.reatReal-d.metaReat)} | Resultado: *${f1(pct(d.reatReal,d.metaReat))}%*

🧺 *Mix de Produtos*
• Meta: ${d.metaMix} | Realizado: ${d.mixReal} | Dif: ${sgn(d.mixReal-d.metaMix)} | Resultado: *${f1(pct(d.mixReal,d.metaMix))}%*`;
  console.log('DADOS:',JSON.stringify(d));
  console.log('\n===== MENSAGEM =====\n'+msg+'\n====================');
  if(process.argv[2]==='send'){
    const p=JSON.stringify({target:'5562996101684',message:msg});
    const req=http.request({host:'localhost',port:3001,path:'/api/whatsapp/send-message',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>console.log(`HTTP ${r.statusCode}: ${b}`));});
    req.on('error',e=>console.error('Erro:',e.message)); req.write(p); req.end();
  }
})();
