require('dotenv').config();
const database = require('../src/config/database');
const svc = require('../src/services/purchasingOracleService');
(async()=>{
  await database.initialize();
  try {
    const rows = await svc.getPurchasingCoverageData({ janelaGiro:90, minDiasComVenda:5 });
    const porFil = {};
    rows.forEach(r=>{ porFil[r.CODFILIAL]=(porFil[r.CODFILIAL]||0)+1; });
    console.log('Total:', rows.length);
    console.log('Itens por filial:', porFil);
    const tem20 = rows.filter(r=>String(r.CODFILIAL).includes('20')||String(r.CODFILIAL)==='6').length;
    console.log('Itens com filial 20/6 (esperado 0):', tem20);
  } catch(e){ console.error('ERRO', e.message); }
  finally { await database.close(); }
})();
