require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
const C=93, FIL='20';
const MESES = [['01/04/2026','30/04/2026'],['01/05/2026','31/05/2026'],['01/06/2026','30/06/2026']];

async function mesIndicadores(conn, di, df){
  const opt={outFormat:oracledb.OUT_FORMAT_OBJECT};
  const one=async(sql,b)=>(await conn.execute(sql,b,opt)).rows[0];
  const D={c:C,fil:FIL,di,df};
  const meta=await one(`SELECT SUM(NVL(VLVENDAPREV,0)) MV,SUM(NVL(QTPEDPREV,0)) MA,SUM(NVL(QTITENSPEDPREV,0)) MR FROM PCMETARCA WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,{c:C,di,df});
  const metaM=await one(`SELECT MAX(MIXPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) MIX,MAX(CLIPOSPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) POS FROM PCMETA WHERE CODUSUR=:c AND TIPOMETA='M' AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,{c:C,di,df});
  const vb=await one(`SELECT NVL(SUM(VLTOTAL),0) B FROM PCNFSAID WHERE CODUSUR=:c AND CODFILIAL=:fil AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14) AND DTSAIDA>=TO_DATE(:di,'DD/MM/YYYY') AND DTSAIDA<TO_DATE(:df,'DD/MM/YYYY')+1`,D);
  const dv=await one(`SELECT NVL(SUM(QT*PUNIT),0) D FROM PCMOV WHERE CODUSUR=:c AND CODFILIAL=:fil AND CODOPER='ED' AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`,D);
  const pos=await one(`SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC WHERE CODUSUR=:c AND CODFILIAL=:fil AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14) AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,D);
  const nov=await one(`SELECT COUNT(DISTINCT cl.codcli) N FROM pcclient cl JOIN pcmov pm ON pm.codcli=cl.codcli JOIN pcpedc pp ON pp.numped=pm.numped AND pp.dtcancel IS NULL AND pp.condvenda IN (1,7,9,14) AND pp.vltotal>=120 WHERE pm.codoper='S' AND pm.codfilial=:fil AND pm.codusur=:c AND pm.dtmov BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY') AND NOT EXISTS (SELECT 1 FROM pcmov pm2 WHERE pm2.codcli=cl.codcli AND pm2.codoper='S' AND pm2.dtmov<TO_DATE(:di,'DD/MM/YYYY'))`,D);
  const res=await one(`SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC PE WHERE PE.CODUSUR=:c AND PE.CODFILIAL=:fil AND PE.DTCANCEL IS NULL AND PE.CONDVENDA IN (1,7,9,14) AND PE.POSICAO='F' AND PE.VLTOTAL>=120 AND PE.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY') AND NOT EXISTS (SELECT 1 FROM PCPEDC P WHERE P.CODCLI=PE.CODCLI AND P.DTCANCEL IS NULL AND P.CONDVENDA IN (1,7,9,14) AND P.POSICAO='F' AND P.DATA BETWEEN ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6) AND ADD_MONTHS(TO_DATE(:df,'DD/MM/YYYY'),-1)) AND EXISTS (SELECT 1 FROM PCPEDC P3 WHERE P3.CODCLI=PE.CODCLI AND P3.DTCANCEL IS NULL AND P3.CONDVENDA IN (1,7,9,14) AND P3.POSICAO='F' AND P3.DATA < ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6))`,D);
  const mix=await one(`SELECT COUNT(DISTINCT CODPROD) N FROM PCMOV WHERE CODUSUR=:c AND CODFILIAL=:fil AND CODOPER='S' AND DTMOV BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,D);
  return {
    metaVenda:Number(meta.MV), liquida:Number(vb.B)-Number(dv.D),
    metaPos:Number(metaM.POS)||0, posReal:Number(pos.N),
    metaAbert:Number(meta.MA), abertReal:Number(nov.N),
    metaReat:Number(meta.MR), reatReal:Number(res.N),
    metaMix:Number(metaM.MIX)||0, mixReal:Number(mix.N)
  };
}
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const acc={metaVenda:0,liquida:0,metaPos:0,posReal:0,metaAbert:0,abertReal:0,metaReat:0,reatReal:0,metaMix:0,mixReal:0};
  for (const [di,df] of MESES){
    const m = await mesIndicadores(conn,di,df);
    console.log(`Mes ${di.slice(3)}: venda meta ${m.metaVenda} real ${m.liquida.toFixed(2)} | pos ${m.metaPos}/${m.posReal} | abert ${m.metaAbert}/${m.abertReal} | reat ${m.metaReat}/${m.reatReal} | mix ${m.metaMix}/${m.mixReal}`);
    for (const k in acc) acc[k]+=m[k];
  }
  await conn.close(); await database.close();
  console.log('\n=== TRIMESTRE (Q2 2026, soma dos 3 meses) ===');
  console.log(JSON.stringify(acc,null,2));

  const brl=n=>'R$ '+Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const f1=n=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
  const pct=(r,m)=>m>0?(r/m*100):0; const sgn=n=>(n>=0?'+':'')+(Number.isInteger(n)?n:f1(n));
  const difV=acc.liquida-acc.metaVenda;
  const msg=
`📊 *Acompanhamento Trimestral de Metas*
👤 *DARTICLEIA ABREU*  (RCA 93 · Filial 20)
🗓️ Trimestre Q2/2026 (abr–jun)

*━━ META QUANTITATIVA ━━*
💰 *Venda Líquida*
• Meta: ${brl(acc.metaVenda)}
• Realizado: ${brl(acc.liquida)}
• Diferença: ${difV>=0?'+':'-'}${brl(Math.abs(difV))}
• Resultado: *${f1(pct(acc.liquida,acc.metaVenda))}%*

*━━ METAS QUALITATIVAS ━━*
✅ *Positivação*
• Meta: ${acc.metaPos} | Realizado: ${acc.posReal} | Dif: ${sgn(acc.posReal-acc.metaPos)} | Resultado: *${f1(pct(acc.posReal,acc.metaPos))}%*

🆕 *Abertura (novos clientes)*
• Meta: ${acc.metaAbert} | Realizado: ${acc.abertReal} | Dif: ${sgn(acc.abertReal-acc.metaAbert)} | Resultado: *${f1(pct(acc.abertReal,acc.metaAbert))}%*

🔄 *Reativação*
• Meta: ${acc.metaReat} | Realizado: ${acc.reatReal} | Dif: ${sgn(acc.reatReal-acc.metaReat)} | Resultado: *${f1(pct(acc.reatReal,acc.metaReat))}%*

🧺 *Mix de Produtos*
• Meta: ${acc.metaMix} | Realizado: ${acc.mixReal} | Dif: ${sgn(acc.mixReal-acc.metaMix)} | Resultado: *${f1(pct(acc.mixReal,acc.metaMix))}%*`;
  console.log('\n===== MENSAGEM =====\n'+msg+'\n====================');
  if(process.argv[2]==='send'){
    const http=require('http');
    const p=JSON.stringify({target:'5562996101684',message:msg});
    const req=http.request({host:'localhost',port:3001,path:'/api/whatsapp/send-message',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>console.log(`HTTP ${r.statusCode}: ${b}`));});
    req.on('error',e=>console.error('Erro:',e.message)); req.write(p); req.end();
  }
})();
