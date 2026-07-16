require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  console.log('=== 18609 e seus possíveis pais (17770 vs 17776) ===');
  const a = await conn.execute(
    `SELECT CODPROD, SUBSTR(DESCRICAO,1,34) DESCR, EMBALAGEM, UNIDADE, QTUNIT, CODFORNEC, CODSEC,
            CODPRODPRINC, CODPRODMASTER FROM PCPRODUT WHERE CODPROD IN (18609,17770,17776) ORDER BY CODPROD`,[],opt);
  console.table(a.rows);

  console.log('\n=== Quantos "filhos" (princ/master <> ele mesmo) no universo do relatório ===');
  const b = await conn.execute(
    `SELECT
        COUNT(*) TOTAL,
        SUM(CASE WHEN CODPRODPRINC IS NOT NULL AND CODPRODPRINC<>CODPROD THEN 1 ELSE 0 END) FILHO_POR_PRINC,
        SUM(CASE WHEN CODPRODMASTER IS NOT NULL AND CODPRODMASTER<>CODPROD THEN 1 ELSE 0 END) FILHO_POR_MASTER,
        SUM(CASE WHEN (CODPRODPRINC IS NOT NULL AND CODPRODPRINC<>CODPROD)
                    OR (CODPRODMASTER IS NOT NULL AND CODPRODMASTER<>CODPROD) THEN 1 ELSE 0 END) FILHO_QUALQUER
     FROM PCPRODUT
     WHERE REVENDA='S' AND CODEPTO IN (1,2,3,7) AND CODFORNEC NOT IN (3,4,14566,14631,14574,14573)
       AND NVL(OBS2,' ')<>'FL' AND CODSEC NOT IN (14,17,20,24,42,10000,10001,10041)`,[],opt);
  console.table(b.rows);

  console.log('\n=== Famílias dos 8 produtos: agrupando por "raiz" (princ ou master) ===');
  // raiz = COALESCE de princ/master quando aponta para outro
  const c = await conn.execute(
    `SELECT CODPROD, SUBSTR(DESCRICAO,1,28) DESCR, QTUNIT, CODPRODPRINC, CODPRODMASTER,
        CASE WHEN CODPRODPRINC<>CODPROD THEN CODPRODPRINC
             WHEN CODPRODMASTER<>CODPROD THEN CODPRODMASTER
             ELSE CODPROD END RAIZ_CALC
     FROM PCPRODUT WHERE CODPROD IN (18617,18261,18605,16801,18604,16799,18609,17776) ORDER BY RAIZ_CALC, CODPROD`,[],opt);
  console.table(c.rows);

  await conn.close(); await database.close();
})();
