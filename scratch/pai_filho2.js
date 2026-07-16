require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const pares = [[18617,18261],[18605,16801],[18604,16799],[18609,17770]];
  const CODS = pares.flat().join(',');

  console.log('=== CADASTRO ===');
  const cad = await conn.execute(
    `SELECT CODPROD, SUBSTR(DESCRICAO,1,32) DESCR, EMBALAGEM, UNIDADE, QTUNITCX, QTUNIT,
            CODFORNEC, CODEPTO, CODSEC, REVENDA, CODPRODPRINC, CODPRODMASTER, FRACIONADO,
            UNIDADEMASTER, EMBALAGEMMASTER
     FROM PCPRODUT WHERE CODPROD IN (${CODS}) ORDER BY CODPROD`,[],opt);
  console.table(cad.rows);

  console.log('\n=== ESTOQUE por filial (PCEST) ===');
  const est = await conn.execute(
    `SELECT CODPROD, CODFILIAL, QTESTGER, QTRESERV, QTBLOQUEADA,
            (NVL(QTESTGER,0)-NVL(QTRESERV,0)-NVL(QTBLOQUEADA,0)) DISP
     FROM PCEST WHERE CODPROD IN (${CODS}) AND CODFILIAL IN ('20','6','21','22','23')
       AND (NVL(QTESTGER,0)<>0 OR NVL(QTRESERV,0)<>0)
     ORDER BY CODPROD, CODFILIAL`,[],opt);
  console.table(est.rows);

  console.log('\n=== VENDAS 90d (PCMOV, líquida) por produto x filial ===');
  const v = await conn.execute(
    `SELECT CODPROD, CASE WHEN CODFILIAL='6' THEN '20' ELSE CODFILIAL END FIL,
            COUNT(DISTINCT TRUNC(DTMOV)) DIAS, SUM(QT-NVL(QTDEVOL,0)) LIQ
     FROM PCMOV WHERE CODPROD IN (${CODS}) AND CODOPER='S' AND DTMOV>=TRUNC(SYSDATE)-90
       AND CODFILIAL IN ('6','20','21','22','23')
     GROUP BY CODPROD, CASE WHEN CODFILIAL='6' THEN '20' ELSE CODFILIAL END
     ORDER BY CODPROD, FIL`,[],opt);
  console.table(v.rows);

  // Mostrar relação declarada: para cada par, o filho aponta para o pai?
  console.log('\n=== RELAÇÃO declarada (filho -> CODPRODPRINC/MASTER) ===');
  pares.forEach(([f,p])=>{
    const cf = cad.rows.find(r=>r.CODPROD===f), cp = cad.rows.find(r=>r.CODPROD===p);
    console.log(`filho ${f} (princ=${cf?.CODPRODPRINC}, master=${cf?.CODPRODMASTER}, frac=${cf?.FRACIONADO}) | pai informado=${p} (princ=${cp?.CODPRODPRINC}, master=${cp?.CODPRODMASTER})`);
  });

  await conn.close(); await database.close();
})();
