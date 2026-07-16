require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const FIL = `'6','20','21','22','23'`;

  // 1. PCMOV tem QTDEVOL? e magnitude das devoluções (90d) no universo monitorado
  console.log('===== DEVOLUCOES: peso sobre vendas (90d) =====');
  const dev = await conn.execute(
    `SELECT
        SUM(CASE WHEN M.CODOPER='S' THEN M.QT ELSE 0 END) AS QT_VENDA_S,
        SUM(CASE WHEN M.CODOPER='S' THEN NVL(M.QTDEVOL,0) ELSE 0 END) AS QTDEVOL_NA_S,
        SUM(CASE WHEN M.CODOPER='ED' THEN M.QT ELSE 0 END) AS QT_ED_DEVOL
     FROM PCMOV M
     WHERE M.DTMOV >= TRUNC(SYSDATE)-90 AND M.CODFILIAL IN (${FIL})
       AND M.CODOPER IN ('S','ED')`, [], opt);
  console.table(dev.rows);

  // 2. Quantos produtos×filial tem devolução relevante (QTDEVOL > 5% da venda)
  console.log('\n===== Produtos com devolução relevante (90d) =====');
  const devProd = await conn.execute(
    `SELECT COUNT(*) AS PRODFIL_COM_VENDA,
            SUM(CASE WHEN DEVOL > 0 THEN 1 ELSE 0 END) AS COM_DEVOL,
            SUM(CASE WHEN DEVOL > 0.05*VENDA THEN 1 ELSE 0 END) AS DEVOL_MAIOR_5PCT,
            SUM(CASE WHEN DEVOL > 0.20*VENDA THEN 1 ELSE 0 END) AS DEVOL_MAIOR_20PCT
     FROM (
       SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END AS FIL,
              SUM(M.QT) AS VENDA, SUM(NVL(M.QTDEVOL,0)) AS DEVOL
       FROM PCMOV M
       WHERE M.DTMOV >= TRUNC(SYSDATE)-90 AND M.CODFILIAL IN (${FIL}) AND M.CODOPER='S'
       GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
     )`, [], opt);
  console.table(devProd.rows);

  // 3. TENDÊNCIA: comparar ritmo recente (30d, 14d) vs média 90d (líquido de QTDEVOL)
  console.log('\n===== TENDÊNCIA: itens acelerando (rate30 vs rate90) =====');
  const tr = await conn.execute(
    `SELECT
        COUNT(*) AS TOTAL,
        SUM(CASE WHEN R30 > 1.5*R90 AND R90 > 0 THEN 1 ELSE 0 END) AS ACEL_30_MAIOR_1_5X,
        SUM(CASE WHEN R30 > 2*R90   AND R90 > 0 THEN 1 ELSE 0 END) AS ACEL_30_MAIOR_2X,
        SUM(CASE WHEN R14 > 2*R90   AND R90 > 0 THEN 1 ELSE 0 END) AS ACEL_14_MAIOR_2X
     FROM (
       SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END AS FIL,
         (SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-90 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END))/90 AS R90,
         (SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-30 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END))/30 AS R30,
         (SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-14 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END))/14 AS R14
       FROM PCMOV M
       WHERE M.DTMOV >= TRUNC(SYSDATE)-90 AND M.CODFILIAL IN (${FIL}) AND M.CODOPER='S'
       GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
       HAVING SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-90 THEN M.QT ELSE 0 END) > 0
     )`, [], opt);
  console.table(tr.rows);

  // 4. Exemplos de itens em forte aceleração: comparar venda_dia atual(90) vs MAX(r30,r90)
  console.log('\n===== EXEMPLOS de aceleração (top 12 por r30/r90) =====');
  const ex = await conn.execute(
    `SELECT * FROM (
       SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END AS FIL,
         ROUND((SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-90 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END))/90,2) AS VDA90,
         ROUND((SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-30 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END))/30,2) AS VDA30,
         ROUND((SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-14 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END))/14,2) AS VDA14
       FROM PCMOV M
       WHERE M.DTMOV >= TRUNC(SYSDATE)-90 AND M.CODFILIAL IN (${FIL}) AND M.CODOPER='S'
       GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
       HAVING (SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-90 THEN M.QT ELSE 0 END))/90 > 1
          AND (SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-30 THEN M.QT ELSE 0 END))/30 >
              2*(SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-90 THEN M.QT ELSE 0 END))/90
       ORDER BY VDA30/NULLIF(VDA90,0) DESC
     ) WHERE ROWNUM <= 12`, [], opt);
  console.table(ex.rows);

  await conn.close(); await database.close();
})();
