require('dotenv').config();
const database = require('../src/config/database');
const svc = require('../src/services/purchasingOracleService');
(async()=>{
  await database.initialize();
  try {
    const rows = await svc.getPurchasingCoverageData({ janelaGiro:90, minDiasComVenda:5 });
    console.log(`Total retornado: ${rows.length}`);
    const alvos = [['18617','21'],['16521','22'],['13956','21'],['18617','20']];
    console.log('\n=== Itens de exemplo (VENDA_DIA ponderada+liquida) ===');
    alvos.forEach(([cod,fil])=>{
      const r = rows.find(x=>String(x.CODPROD)===cod && (String(x.CODFILIAL)===fil || String(x.CODFILIAL)===fil+' + 6'.slice(0,0)));
      // filial 21/22 nao remapeada; 20 vira '20 + 6'
      const r2 = rows.filter(x=>String(x.CODPROD)===cod);
      r2.forEach(x=>console.log(`  prod ${x.CODPROD} fil ${x.CODFILIAL}: VENDA_DIA=${x.VENDA_DIA}  cobFis=${x.COBERTURA_FISICA}  status=${x.STATUS}`));
    });
    // sanity: nenhum VENDA_DIA negativo
    const neg = rows.filter(x=>x.VENDA_DIA < 0);
    console.log(`\nVENDA_DIA negativos: ${neg.length} (esperado 0)`);
    const cnt = {CRITICO:0,ATENCAO:0,SAUDAVEL:0};
    rows.forEach(x=>cnt[x.STATUS]++);
    console.log('Distribuição status:', cnt);
  } catch(e){ console.error('ERRO', e.message); }
  finally { await database.close(); }
})();
