require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const J=90;
  // Universo do relatório + sinais de concentração
  const base = `
    SELECT V.CODPROD, V.FIL, V.DIAS, V.TOTAL_LIQ, V.NCLI, V.MAIOR_CLI, V.MAIOR_DIA,
           ROUND(V.MAIOR_CLI/NULLIF(V.TOTAL_LIQ,0),2) PCT_CLI,
           ROUND(V.MAIOR_DIA/NULLIF(V.TOTAL_LIQ,0),2) PCT_DIA
    FROM (
      SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END AS FIL,
        COUNT(DISTINCT TRUNC(M.DTMOV)) DIAS,
        SUM(M.QT-NVL(M.QTDEVOL,0)) TOTAL_LIQ,
        COUNT(DISTINCT M.CODCLI) NCLI,
        MAX(CLI_SUM) MAIOR_CLI, MAX(DIA_SUM) MAIOR_DIA
      FROM (
        SELECT M.*,
          SUM(M.QT-NVL(M.QTDEVOL,0)) OVER (PARTITION BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END, M.CODCLI) CLI_SUM,
          SUM(M.QT-NVL(M.QTDEVOL,0)) OVER (PARTITION BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END, TRUNC(M.DTMOV)) DIA_SUM
        FROM PCMOV M
        WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-${J} AND M.CODFILIAL IN ('6','20','21','22','23')
      ) M
      GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
      HAVING COUNT(DISTINCT TRUNC(M.DTMOV))>=5
    ) V
    JOIN PCPRODUT P ON P.CODPROD=V.CODPROD
    WHERE P.REVENDA='S' AND P.CODEPTO IN (1,2,3,7)
      AND P.CODFORNEC NOT IN (3,4,14566,14631,14574,14573) AND NVL(P.OBS2,' ')<>'FL'
      AND V.TOTAL_LIQ>0`;

  const res = await conn.execute(
    `SELECT COUNT(*) TOTAL,
       SUM(CASE WHEN PCT_CLI>=0.7 THEN 1 ELSE 0 END) CLI_MAIOR_70,
       SUM(CASE WHEN PCT_CLI>=0.5 THEN 1 ELSE 0 END) CLI_MAIOR_50,
       SUM(CASE WHEN NCLI=1 THEN 1 ELSE 0 END) CLI_UNICO,
       SUM(CASE WHEN PCT_DIA>=0.5 THEN 1 ELSE 0 END) DIA_MAIOR_50,
       SUM(CASE WHEN DIAS<8 THEN 1 ELSE 0 END) DIAS_MENOS_8,
       SUM(CASE WHEN PCT_CLI>=0.7 OR PCT_DIA>=0.5 OR NCLI=1 THEN 1 ELSE 0 END) SUSPEITO_QUALQUER
     FROM (${base})`, [], opt);
  console.log('=== UNIVERSO DO RELATÓRIO: sinais de concentração ===');
  console.table(res.rows);

  // Exemplos dos "suspeitos" com mais volume
  const ex = await conn.execute(
    `SELECT * FROM (
       SELECT B.*, P.DESCRICAO FROM (${base}) B JOIN PCPRODUT P ON P.CODPROD=B.CODPROD
       WHERE (B.PCT_CLI>=0.7 OR B.PCT_DIA>=0.5 OR B.NCLI=1)
       ORDER BY B.TOTAL_LIQ DESC
     ) WHERE ROWNUM<=12`, [], opt);
  console.log('\n=== EXEMPLOS suspeitos (maior volume) ===');
  console.table(ex.rows.map(r=>({COD:r.CODPROD,FIL:r.FIL,DESC:(r.DESCRICAO||'').slice(0,28),DIAS:r.DIAS,NCLI:r.NCLI,PCT_CLI:r.PCT_CLI,PCT_DIA:r.PCT_DIA,TOT:r.TOTAL_LIQ})));

  await conn.close(); await database.close();
})();
