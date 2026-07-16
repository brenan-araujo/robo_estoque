require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const CODS = '18617,18261,18605,16801,18604,16799,18609,17770';

  // 1. Colunas de PCPRODUT que possam indicar vínculo pai/filho
  console.log('=== colunas PCPRODUT (principal/pai/master/kit/fator/conv/frac) ===');
  const c = await conn.execute(
    `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCPRODUT' AND OWNER='BRAGO'
      AND (UPPER(COLUMN_NAME) LIKE '%PRINC%' OR UPPER(COLUMN_NAME) LIKE '%PAI%' OR UPPER(COLUMN_NAME) LIKE '%MASTER%'
        OR UPPER(COLUMN_NAME) LIKE '%KIT%' OR UPPER(COLUMN_NAME) LIKE '%FATOR%' OR UPPER(COLUMN_NAME) LIKE '%CONV%'
        OR UPPER(COLUMN_NAME) LIKE '%FRAC%' OR UPPER(COLUMN_NAME) LIKE '%MEPAI%' OR UPPER(COLUMN_NAME) LIKE '%DESDOBR%'
        OR UPPER(COLUMN_NAME) LIKE '%ORIGEM%' OR UPPER(COLUMN_NAME) LIKE '%VINCUL%')
     ORDER BY COLUMN_ID`,[],opt);
  console.table(c.rows);

  // 2. Cadastro dos 8 produtos
  console.log('\n=== CADASTRO dos 8 produtos ===');
  const cad = await conn.execute(
    `SELECT CODPROD, SUBSTR(DESCRICAO,1,30) DESCR, EMBALAGEM, UNIDADE, QTUNITCX, QTUNIT,
            CODFORNEC, CODEPTO, CODSEC, REVENDA, CODPRODPRINC, FATORCONV
     FROM PCPRODUT WHERE CODPROD IN (${CODS}) ORDER BY CODPROD`,[],opt);
  console.table(cad.rows);

  await conn.close(); await database.close();
})();
