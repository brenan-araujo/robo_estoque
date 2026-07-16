require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

(async () => {
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  
  try {
    console.log("=== Analisando colunas de erro/mensagem em PCPEDCFV para rejeitados ===");
    // Let's select a few rows where POSICAO_ATUAL = 'R' or IMPORTADO = 9
    const r1 = await conn.execute(
      `SELECT NUMPEDRCA, CODUSUR, CODCLI, DTINCLUSAO, IMPORTADO, POSICAO_ATUAL, 
              DBMS_LOB.SUBSTR(OBSERVACAO_PC, 200, 1) AS OBS_PC_SHORT,
              DBMS_LOB.SUBSTR(OBS1, 100, 1) AS OBS1_SHORT,
              DBMS_LOB.SUBSTR(OBS2, 100, 1) AS OBS2_SHORT
       FROM PCPEDCFV 
       WHERE POSICAO_ATUAL = 'R' AND ROWNUM <= 5`,
      {}, opt
    );
    console.log("PCPEDCFV (POSICAO_ATUAL = 'R') sample rows:");
    console.log(JSON.stringify(r1.rows, null, 2));

    const r2 = await conn.execute(
      `SELECT NUMPEDRCA, CODUSUR, CODCLI, DTINCLUSAO, IMPORTADO, POSICAO_ATUAL,
              DBMS_LOB.SUBSTR(OBSERVACAO_PC, 200, 1) AS OBS_PC_SHORT
       FROM PCPEDCFV 
       WHERE IMPORTADO = 9 AND ROWNUM <= 5`,
      {}, opt
    );
    console.log("PCPEDCFV (IMPORTADO = 9) sample rows:");
    console.log(JSON.stringify(r2.rows, null, 2));

    // Can we link PCPEDCFV to PCLOG_INTEGRADORA?
    if (r1.rows.length > 0) {
      const sampleOrder = r1.rows[0];
      console.log(`=== Buscando log de erro correspondente para RCA ${sampleOrder.CODUSUR} PedidoRCA ${sampleOrder.NUMPEDRCA} ===`);
      const r3 = await conn.execute(
        `SELECT MSG, DATA, SEQ 
         FROM PCLOG_INTEGRADORA 
         WHERE CODUSUR = :codUsur AND NUMPEDRCA = :numPedRca AND ROWNUM <= 5`,
        { codUsur: sampleOrder.CODUSUR, numPedRca: sampleOrder.NUMPEDRCA },
        opt
      );
      console.log("PCLOG_INTEGRADORA matching rows:");
      console.log(JSON.stringify(r3.rows, null, 2));
    }

  } catch (e) {
    console.error("FAIL:", e.message);
  }
  
  await conn.close();
  await database.close();
})();
