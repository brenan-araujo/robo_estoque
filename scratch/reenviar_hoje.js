require('dotenv').config();
const http = require('http');
const database = require('../src/config/database');
const { getNewEntries, groupByFilial, formatMessage } = require('../src/services/oracleService');
const configManager = require('../src/utils/configManager');

// Lista completa de vendedores por filial vinda do settings.json (a lista curada)
function sellersDaFilial(codFilial){
  const s = configManager.getSettings().filialNumbers || {};
  let str = s[String(codFilial)] || '';
  if (codFilial==='20' || codFilial==='6'){
    str = [s['6']||'', s['20']||''].filter(Boolean).join(', ');
  }
  return Array.from(new Set(str.split(/[\n,]+/).map(n=>n.trim().replace(/\D/g,'')).filter(n=>n.length>=8)));
}
function post(target, message){
  return new Promise(res=>{
    const p=JSON.stringify({target,message});
    const req=http.request({host:'localhost',port:3001,path:'/api/whatsapp/send-message',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}},
      r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res({code:r.statusCode,body:b}));});
    req.on('error',e=>res({code:0,body:e.message})); req.write(p); req.end();
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  await database.initialize();
  const inicioHoje = new Date(2026,6,1,0,0,0); // 01/07/2026 00:00 local
  const entries = await getNewEntries(inicioHoje);
  const grouped = groupByFilial(entries);
  const SEND = process.argv[2]==='send';

  console.log(`Total de itens que chegaram hoje: ${entries.length}`);
  const plano = [];
  for (const [cod, data] of Object.entries(grouped)){
    const msg = formatMessage(cod, data);
    const sellers = sellersDaFilial(cod);
    plano.push({cod, itens:data.items.length, sellers, msg});
    console.log(`\n===== FILIAL ${cod} (${data.nomeFilial}) — ${data.items.length} itens → ${sellers.length} vendedores =====`);
    if (cod==='20' || Object.keys(grouped)[0]===cod) console.log(msg);
  }
  const totalEnvios = plano.reduce((a,p)=>a+p.sellers.length,0);
  console.log(`\n>>> TOTAL DE ENVIOS SE CONFIRMAR: ${totalEnvios} mensagens (${plano.map(p=>p.cod+':'+p.sellers.length).join(', ')})`);

  if (SEND){
    console.log('\n=== ENVIANDO (delay 6s entre mensagens) ===');
    let ok=0, fail=0;
    for (const p of plano){
      for (const num of p.sellers){
        const r = await post(num, p.msg);
        if (r.code===200 && /sucesso/i.test(r.body)) { ok++; }
        else { fail++; console.log(`  falha ${num}: ${r.body}`); }
        await sleep(6000);
      }
    }
    console.log(`\nConcluído. Sucesso: ${ok}, Falhas: ${fail}`);
  }
  await database.close();
})();
