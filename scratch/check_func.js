require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const o = await conn.execute(
    `SELECT OWNER, OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OBJECT_NAME='FUNC_RESUMOFATURAMENTO'`,[],opt);
  console.log('Objeto:'); console.table(o.rows);
  // teste 1: literal sem prefixo
  for (const expr of ["FUNC_RESUMOFATURAMENTO", "BRAGO.FUNC_RESUMOFATURAMENTO"]) {
    try {
      const r = await conn.execute(
        `SELECT COUNT(*) N FROM TABLE(${expr}(P_CODFILIAL => '20', P_DATAINI => TO_DATE('01/06/2026','DD/MM/YYYY'), P_DATAFIM => TO_DATE('30/06/2026','DD/MM/YYYY'), P_TIPOPESQUISA => '22', P_CONDVENDA => '1,7,9,14', P_TIPOVENDA10 => '0', P_BONIFICACAO => '1', P_DEVOLUCAO => '1', P_DESCST => '1', P_DESCIPI => '0', P_META => '0', P_LUCRO_LIQ => '0', P_CONSIDTIPOFJ => '0', P_CONSIDCONSUMIDORFINAL => '0', P_CONSIDISENTO => '0', P_CONSIDISENTA => '0', P_SUPERVMOV => '0', P_PRAZOADICIONAL => '0', P_CONSIDERARDEVOLTV8 => '0', P_DESCVLREPASSE => '0', P_DESCVLTABELA => '0', P_CONSIDERANOTASAPROVADAS => '0', P_DESCONSIDERARCLIVINCFORNEC => '0', P_CONSIDERACOBRANCATITULOS => '0', P_CONSIDERA_APLIC_VERBA => 'N', P_DESCFECP => '0'))`,[],opt);
      console.log(`OK [${expr}] -> N=${r.rows[0].N}`);
    } catch(e){ console.log(`FALHOU [${expr}]: ${e.message}`); }
  }
  await conn.close(); await database.close();
})();
