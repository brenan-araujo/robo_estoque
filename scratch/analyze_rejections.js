require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  try {
    console.log("=== Analisando status de IMPORTADO na PCPEDCFV ===");
    const r1 = await conn.execute(
      `SELECT IMPORTADO, COUNT(*) AS QTD FROM PCPEDCFV GROUP BY IMPORTADO ORDER BY QTD DESC`,
      {}, opt
    );
    console.table(r1.rows);
    
    console.log("=== Analisando status de RETORNO na PCPEDCFV ===");
    const r2 = await conn.execute(
      `SELECT RETORNO, COUNT(*) AS QTD FROM PCPEDCFV GROUP BY RETORNO ORDER BY QTD DESC`,
      {}, opt
    );
    console.table(r2.rows);

    console.log("=== Analisando POSICAO_ATUAL na PCPEDCFV ===");
    const r3 = await conn.execute(
      `SELECT POSICAO_ATUAL, COUNT(*) AS QTD FROM PCPEDCFV GROUP BY POSICAO_ATUAL ORDER BY QTD DESC`,
      {}, opt
    );
    console.table(r3.rows);
    
    console.log("=== Exemplos de logs em PCLOG_INTEGRADORA com mensagens de erro ===");
    // In WinThor, error logs often contain keywords like 'erro', 'rejeitado', 'invalido', 'bloqueado'
    const r4 = await conn.execute(
      `SELECT MSG, DATA, CODUSUR 
       FROM PCLOG_INTEGRADORA 
       WHERE (UPPER(MSG) LIKE '%ERRO%' OR UPPER(MSG) LIKE '%REJEITAD%' OR UPPER(MSG) LIKE '%FALHA%' OR UPPER(MSG) LIKE '%INVÁLID%')
         AND ROWNUM <= 10`,
      {}, opt
    );
    r4.rows.forEach((row, i) => {
      console.log(`[Log ${i+1}] RCA ${row.CODUSUR} (${row.DATA}): ${row.MSG}`);
    });
    
  } catch (e) {
    console.error("FAIL:", e.message);
  }
  
  await conn.close();
  await database.close();
})();
