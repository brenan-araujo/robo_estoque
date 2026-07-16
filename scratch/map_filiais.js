require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  console.log('===== PCFILIAL =====');
  const f = await conn.execute(`SELECT CODIGO, FANTASIA, UF, CODCLI, CODFORNEC, CODGRUPO FROM PCFILIAL ORDER BY CODIGO`,[],opt);
  console.table(f.rows);

  // CODCLI list of filiais
  const filClis = f.rows.filter(r=>r.CODCLI).map(r=>r.CODCLI);
  console.log('CODCLI das filiais:', filClis.join(','));

  // NFs de saida cujo cliente é uma filial (= transferência entre filiais), 180d
  console.log('\n===== NFs SAIDA com CLIENTE = FILIAL (transf entre filiais), 180d =====');
  const nf = await conn.execute(
    `SELECT N.CODFILIAL AS ORIGEM, N.CODCLI, COUNT(*) QTD, MIN(N.DTSAIDA) DESDE, MAX(N.DTSAIDA) ATE
     FROM PCNFSAID N
     WHERE N.CODCLI IN (${filClis.join(',')}) AND N.DTSAIDA >= SYSDATE-180 AND N.DTCANCEL IS NULL
     GROUP BY N.CODFILIAL, N.CODCLI ORDER BY QTD DESC`,[],opt);
  console.table(nf.rows);

  await conn.close(); await database.close();
})();
