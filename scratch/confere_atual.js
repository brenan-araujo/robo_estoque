require('dotenv').config();
const database = require('../src/config/database');
const svc = require('../src/services/purchasingOracleService');
(async()=>{
  await database.initialize();
  try {
    const rows = await svc.getPurchasingCoverageData({ janelaGiro:90, minDiasComVenda:5 });
    const alvos = [
      [16916,'20 + 6'], [17016,'21'], [13018,'21'], [13018,'22'],
      [15889,'22'], [17803,'22'], [15624,'20 + 6'], [2270,'20 + 6']
    ];
    console.log('CODPROD | FILIAL | VendaDiaPeso | VendaDia90 | Estoque | Sugestao(calc) | Status');
    const round=(n,d=3)=>Math.round(n*10**d)/10**d;
    alvos.forEach(([c,f])=>{
      const r = rows.find(x=>Number(x.CODPROD)===c && String(x.CODFILIAL)===f)
             || rows.find(x=>Number(x.CODPROD)===c);
      if(!r){ console.log(`${c} / ${f} -> não encontrado`); return; }
      const vd=Number(r.VENDA_DIA), est=Number(r.ESTOQUE_DISPONIVEL), saldo=Number(r.SALDO_PEDIDO), prazo=Number(r.TEMPO_FORNEC)||7;
      let sug=0; const ct=vd>0?(est+saldo)/vd:9999;
      if(ct<prazo && vd>0){ const raw=vd*prazo-(est+saldo); sug=est===0?Math.max(1,Math.ceil(raw)):Math.max(0,Math.round(raw)); }
      console.log(`${c} | ${r.CODFILIAL} | ${round(vd)} | ${round(Number(r.VENDA_DIA_90))} | ${est} | ${sug} | ${r.STATUS}`);
    });
    console.log('\nData/hora servidor desta consulta:', new Date().toLocaleString('pt-BR'));
  } catch(e){ console.error('ERRO', e.message); }
  finally { await database.close(); }
})();
