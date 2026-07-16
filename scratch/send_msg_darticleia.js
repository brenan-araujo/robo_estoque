const http = require('http');
const brl = n => 'R$ ' + Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct = (r,m) => m>0 ? (r/m*100) : 0;
const f1 = n => Number(n).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const sgn = n => (n>=0?'+':'') + (Number.isInteger(n)? n : f1(n));

const d = {
  metaVenda:133000, liquida:117117.84,
  metaPos:48, posReal:52,
  metaAbert:2, abertReal:1,
  metaReat:4, reatReal:1,
  metaMix:144, mixReal:155
};
const difVenda = d.liquida - d.metaVenda;

const msg =
`📊 *Acompanhamento de Metas — Junho/2026*
👤 *DARTICLEIA ABREU*  (RCA 93 · Filial 20)
🗓️ Período: 01/06 a 30/06/2026

*━━ META QUANTITATIVA ━━*
💰 *Venda Líquida*
• Meta: ${brl(d.metaVenda)}
• Realizado: ${brl(d.liquida)}
• Diferença: ${difVenda>=0?'+':'-'}${brl(Math.abs(difVenda)).replace('R$ ','R$ ')}
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

console.log('===== PRÉVIA DA MENSAGEM =====\n'+msg+'\n==============================');

if (process.argv[2]==='send') {
  const payload = JSON.stringify({ target:'5562996101684', message: msg });
  const req = http.request({host:'localhost',port:3001,path:'/api/whatsapp/send-message',method:'POST',
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},
    res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>console.log(`HTTP ${res.statusCode}: ${b}`));});
  req.on('error',e=>console.error('Erro:',e.message));
  req.write(payload); req.end();
}
