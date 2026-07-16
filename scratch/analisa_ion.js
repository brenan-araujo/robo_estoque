require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const cols = async (tab, like) => {
    const r = await conn.execute(
      `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME=:t AND OWNER='BRAGO'
        AND UPPER(COLUMN_NAME) LIKE :l ORDER BY COLUMN_NAME`, {t:tab,l:like}, opt);
    return r.rows.map(x=>x.COLUMN_NAME).join(', ') || '(nenhuma)';
  };

  console.log('== ENVIARFORCAVENDAS ==');
  console.log(' PCPRODUT   :', await cols('PCPRODUT','%FORCAVEND%'));
  console.log(' PCPRODFILIAL:', await cols('PCPRODFILIAL','%FORCAVEND%'));
  console.log('== IONSYNC ==');
  console.log(' PCPRODUT   :', await cols('PCPRODUT','%IONSYNC%'));
  console.log(' PCPRODFILIAL:', await cols('PCPRODFILIAL','%IONSYNC%'));
  console.log('== PROIBIDAVENDA/FORALINHA/ATIVO ==');
  console.log(' PCPRODFILIAL:', await cols('PCPRODFILIAL','%PROIBIDA%'), '|', await cols('PCPRODFILIAL','%FORALINHA%'), '|', await cols('PCPRODFILIAL','%ATIVO%'));
  console.log('== CUSTOS em PCEST ==');
  console.log(' PCEST:', await cols('PCEST','%CUSTO%'));

  // Regiões por filial (avaliar duplicação do join OR '99')
  console.log('\n== PCREGIAO: regiões por filial-alvo + status ==');
  const reg = await conn.execute(
    `SELECT CODFILIAL, COUNT(*) QTD_REGIOES, COUNT(DISTINCT NUMREGIAO) NUMREGIOES
     FROM PCREGIAO WHERE (CODFILIAL IN ('6','20','21','22','23') OR CODFILIAL='99') AND STATUS NOT IN ('I','C')
     GROUP BY CODFILIAL ORDER BY CODFILIAL`, [], opt);
  console.table(reg.rows);

  await conn.close(); await database.close();
})();
