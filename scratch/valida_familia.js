require('dotenv').config();
const database = require('../src/config/database');
const svc = require('../src/services/purchasingOracleService');
(async()=>{
  await database.initialize();
  try {
    const rows = await svc.getPurchasingCoverageData({ janelaGiro:90, minDiasComVenda:5 });
    console.log('Total linhas:', rows.length);

    const pais = [16799,16801,18261,17776];
    const filhos = [18604,18605,18617,18609];

    console.log('\n=== PAIS (devem aparecer, consolidados) — filial 21 ===');
    pais.forEach(c=>{
      const r = rows.find(x=>Number(x.CODPROD)===c && String(x.CODFILIAL)==='21');
      if(r) console.log(`  ${c} ${String(r.DESCRICAO).slice(0,22)} | vda ${Number(r.VENDA_DIA).toFixed(2)} | est ${r.ESTOQUE_DISPONIVEL} | cobFis ${r.COBERTURA_FISICA} | ${r.STATUS}`);
      else console.log(`  ${c} — não apareceu na filial 21`);
    });

    console.log('\n=== FILHOS (NÃO devem aparecer como linha própria) ===');
    filhos.forEach(c=>{
      const n = rows.filter(x=>Number(x.CODPROD)===c).length;
      console.log(`  ${c}: ${n} linha(s) ${n===0?'✓ (consolidado no pai)':'✗ AINDA APARECE'}`);
    });

    // spot-check produto sem família (standalone) — deve ter QTUNIT próprio, comportamento igual
    console.log('\n=== Spot-check standalone (ex.: 18048, 17016 se existirem) ===');
    [18048,17016,15669].forEach(c=>{
      const r = rows.find(x=>Number(x.CODPROD)===c);
      if(r) console.log(`  ${c} fil ${r.CODFILIAL} | vda ${Number(r.VENDA_DIA).toFixed(2)} | est ${r.ESTOQUE_DISPONIVEL} | ${r.STATUS}`);
    });

    const cnt={}; rows.forEach(x=>cnt[x.STATUS]=(cnt[x.STATUS]||0)+1);
    console.log('\nStatus:', cnt);
  } catch(e){ console.error('ERRO', e.message); console.error(e.stack); }
  finally { await database.close(); }
})();
