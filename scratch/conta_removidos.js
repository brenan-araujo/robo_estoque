require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt={outFormat:oracledb.OUT_FORMAT_OBJECT};
  // itens do universo do relatório (com venda) que pertenciam às seções de personalização
  const r = await conn.execute(
   `SELECT P.CODSEC, S.DESCRICAO, COUNT(DISTINCT V.CODPROD||'-'||V.FIL) ITENS
    FROM (
      SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END FIL,
             COUNT(DISTINCT TRUNC(M.DTMOV)) DIAS
      FROM PCMOV M WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-90 AND M.CODFILIAL IN ('6','20','21','22','23')
      GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
      HAVING COUNT(DISTINCT TRUNC(M.DTMOV))>=5
    ) V
    JOIN PCPRODUT P ON P.CODPROD=V.CODPROD
    JOIN PCSECAO S ON S.CODSEC=P.CODSEC
    WHERE P.REVENDA='S' AND P.CODEPTO IN (1,2,3,7)
      AND P.CODFORNEC NOT IN (3,4,14566,14631,14574,14573) AND NVL(P.OBS2,' ')<>'FL'
      AND P.CODSEC IN (14,17,20,24,42,10000,10001,10041)
    GROUP BY P.CODSEC, S.DESCRICAO ORDER BY ITENS DESC`,[],opt);
  console.table(r.rows);
  const tot=r.rows.reduce((a,x)=>a+Number(x.ITENS),0);
  console.log('Total removido:', tot);
  await conn.close(); await database.close();
})();
