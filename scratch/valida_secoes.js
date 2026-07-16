require('dotenv').config();
const database = require('../src/config/database');
const svc = require('../src/services/purchasingOracleService');
const { getConnection } = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  try {
    const rows = await svc.getPurchasingCoverageData({ janelaGiro:90, minDiasComVenda:5 });
    console.log('Total agora:', rows.length);
    // checar se sobrou algum produto das seções de personalização
    const conn = await getConnection();
    const cods = rows.map(r=>r.CODPROD);
    // amostra: quantos produtos do resultado pertencem a seções de personalizacao
    const r = await conn.execute(
      `SELECT COUNT(*) N FROM PCPRODUT WHERE CODPROD IN (${cods.length?cods.join(','):0})
        AND CODSEC IN (14,17,20,24,42,10000,10001,10041)`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});
    console.log('Itens de personalização que sobraram (esperado 0):', r.rows[0].N);
    const porFil={}; rows.forEach(x=>porFil[x.CODFILIAL]=(porFil[x.CODFILIAL]||0)+1);
    console.log('Por filial:', porFil);
    await conn.close();
  } catch(e){ console.error('ERRO', e.message); }
  finally { await database.close(); }
})();
