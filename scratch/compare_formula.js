require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const J = 90;
  const q = await conn.execute(
    `SELECT M.CODPROD,
        CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END AS FIL,
        ROUND(SUM(M.QT)/:J, 2) AS VDA_ANTIGO,
        ROUND(SUM(M.QT-NVL(M.QTDEVOL,0))/:J, 2) AS VDA_LIQ_PLANO,
        ROUND(GREATEST((
            3*SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-(:J/3) THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END)
          + 2*SUM(CASE WHEN M.DTMOV<TRUNC(SYSDATE)-(:J/3) AND M.DTMOV>=TRUNC(SYSDATE)-(2*:J/3) THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END)
          + 1*SUM(CASE WHEN M.DTMOV<TRUNC(SYSDATE)-(2*:J/3) THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END)
          )/(2*:J),0), 2) AS VDA_NOVO_PONDERADO
     FROM PCMOV M
     WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-:J
       AND M.CODFILIAL IN ('6','20','21','22','23')
       AND M.CODPROD IN (18617,16521,13956,14044)
     GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
     ORDER BY M.CODPROD, FIL`, {J}, opt);
  console.table(q.rows);
  await conn.close(); await database.close();
})();
