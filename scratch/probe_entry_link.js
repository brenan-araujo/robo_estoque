require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // date cols of PCNFENT
  const dc = await conn.execute(`SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCNFENT' AND OWNER='BRAGO' AND (DATA_TYPE='DATE' OR UPPER(COLUMN_NAME) LIKE '%TRANSVEND%' OR UPPER(COLUMN_NAME) LIKE '%NUMTRANS%') ORDER BY COLUMN_ID`,[],opt);
  console.log('PCNFENT cols relevantes:', dc.rows.map(x=>x.COLUMN_NAME).join(', '));

  // pick a real inter-state transfer saida NF: origin 20 -> cliente 44775 (filial 21)
  console.log('\n===== amostra saida 20 -> filial21(44775) =====');
  const s = await conn.execute(
    `SELECT NUMNOTA, NUMTRANSVENDA, CODFILIAL, CODCLI, DTSAIDA
     FROM PCNFSAID WHERE CODCLI=44775 AND CODFILIAL='20' AND DTCANCEL IS NULL AND DTSAIDA>=SYSDATE-180
     ORDER BY DTSAIDA DESC FETCH FIRST 5 ROWS ONLY`,[],opt);
  console.table(s.rows);

  if (s.rows.length){
    const tv = s.rows[0].NUMTRANSVENDA;
    const nn = s.rows[0].NUMNOTA;
    console.log(`\n===== procurar ENTRADA ligada a NUMTRANSVENDA=${tv} / NUMNOTA=${nn} =====`);
    // try by NUMTRANSVENDAORIG
    const e1 = await conn.execute(
      `SELECT NUMTRANSENT, CODFILIAL, CODFORNEC, NUMNOTA, DTENT, NUMTRANSVENDAORIG
       FROM PCNFENT WHERE NUMTRANSVENDAORIG = :tv FETCH FIRST 5 ROWS ONLY`, {tv}, opt);
    console.log('por NUMTRANSVENDAORIG:', e1.rows.length); console.table(e1.rows);
    // try by same NUMNOTA + fornecedor=filial20 (14566)
    const e2 = await conn.execute(
      `SELECT NUMTRANSENT, CODFILIAL, CODFORNEC, NUMNOTA, DTENT
       FROM PCNFENT WHERE NUMNOTA = :nn AND CODFORNEC=14566 FETCH FIRST 5 ROWS ONLY`, {nn}, opt);
    console.log('por NUMNOTA+fornec filial20:', e2.rows.length); console.table(e2.rows);
  }

  await conn.close(); await database.close();
})();
