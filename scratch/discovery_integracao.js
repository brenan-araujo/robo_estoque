require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // 1. Como os pedidos entram hoje? (ORIGEMPED na PCPEDC)
  const o = await conn.execute(
    `SELECT ORIGEMPED, COUNT(*) N FROM PCPEDC
     WHERE DATA >= SYSDATE-90 GROUP BY ORIGEMPED ORDER BY N DESC`, [], opt);
  console.log('ORIGEM DOS PEDIDOS (90d):'); console.table(o.rows);

  // 2. Tabelas de staging de integração (Força de Vendas e afins)
  const t = await conn.execute(
    `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER='BRAGO'
       AND (TABLE_NAME LIKE 'PCPEDCFV%' OR TABLE_NAME LIKE 'PCPEDIFV%'
         OR TABLE_NAME LIKE '%PEDIDOFV%' OR TABLE_NAME LIKE 'PCIMPORT%'
         OR TABLE_NAME LIKE '%INTEGRA%PED%' OR TABLE_NAME LIKE 'PCPEDC_%' OR TABLE_NAME LIKE 'PCSINCPED%')
     ORDER BY TABLE_NAME`, [], opt);
  console.log('TABELAS DE STAGING/INTEGRAÇÃO:', t.rows.map(r=>r.TABLE_NAME).join(', ') || '(nenhuma)');

  // 3. Staging FV em uso? (registros)
  for (const tb of ['PCPEDCFV','PCPEDIFV']) {
    try {
      const r = await conn.execute(`SELECT COUNT(*) N FROM ${tb}`, [], opt);
      console.log(`${tb}: ${r.rows[0].N} registros`);
    } catch(e){ console.log(`${tb}: não acessível (${e.message.split('\n')[0]})`); }
  }

  // 4. Múltiplos endereços de entrega por cliente (PCCLIENTENDENT)
  const e = await conn.execute(
    `SELECT COUNT(*) TOTAL, COUNT(DISTINCT CODCLI) CLIENTES FROM PCCLIENTENDENT`, [], opt);
  console.log('PCCLIENTENDENT (endereços de entrega):', e.rows[0]);

  // 5. Clientes com mais endereços (o "cliente grande" provavelmente está aqui)
  const c = await conn.execute(
    `SELECT E.CODCLI, C.CLIENTE, COUNT(*) ENDERECOS
     FROM PCCLIENTENDENT E JOIN PCCLIENT C ON C.CODCLI=E.CODCLI
     GROUP BY E.CODCLI, C.CLIENTE ORDER BY ENDERECOS DESC FETCH FIRST 6 ROWS ONLY`, [], opt);
  console.log('CLIENTES COM MAIS ENDEREÇOS:'); console.table(c.rows);

  await conn.close(); await database.close();
})();
