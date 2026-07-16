require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const COD=18604, FIL=`'21'`;

  // Cadastro
  const cad = await conn.execute(
    `SELECT P.CODPROD, P.DESCRICAO, P.EMBALAGEM, P.UNIDADE, P.QTUNITCX, P.CODFORNEC,
            F.FANTASIA FORNEC, NVL(F.PRAZOENTREGA,7) PRAZO, P.CODEPTO, P.REVENDA
     FROM PCPRODUT P LEFT JOIN BRAGO.PCFORNEC F ON F.CODFORNEC=P.CODFORNEC
     WHERE P.CODPROD=:c`, {c:COD}, opt);
  console.log('=== CADASTRO ==='); console.table(cad.rows);

  // Estoque e saldo pedido
  const est = await conn.execute(
    `SELECT
       (SELECT NVL(SUM(NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)),0) FROM PCEST E WHERE E.CODPROD=:c AND E.CODFILIAL=21) ESTOQUE_DISP,
       (SELECT NVL(SUM(NVL(E.QTESTGER,0)),0) FROM PCEST E WHERE E.CODPROD=:c AND E.CODFILIAL=21) EST_GERAL,
       (SELECT NVL(SUM(NVL(E.QTRESERV,0)),0) FROM PCEST E WHERE E.CODPROD=:c AND E.CODFILIAL=21) RESERV,
       (SELECT NVL(SUM(NVL(I.QTPEDIDA,0)-NVL(I.QTENTREGUE,0)),0) FROM PCITEM I JOIN PCPEDIDO PE ON I.NUMPED=PE.NUMPED
          WHERE I.CODPROD=:c AND (I.QTPEDIDA-NVL(I.QTENTREGUE,0))>0 AND PE.DTPREVENT>=TRUNC(SYSDATE) AND PE.DTENTRADAESTOQUE IS NULL AND PE.CODFILIAL=21) SALDO_PED
     FROM DUAL`, {c:COD}, opt);
  console.log('=== ESTOQUE / PEDIDO (filial 21) ==='); console.table(est.rows);

  // Vendas por semana (12 semanas) - bruto, devol, liquido, dias com venda
  const sem = await conn.execute(
    `SELECT TO_CHAR(TRUNC(M.DTMOV,'IW'),'DD/MM') SEMANA,
            SUM(M.QT) BRUTO, SUM(NVL(M.QTDEVOL,0)) DEVOL, SUM(M.QT-NVL(M.QTDEVOL,0)) LIQUIDO,
            COUNT(DISTINCT TRUNC(M.DTMOV)) DIAS, COUNT(DISTINCT M.CODCLI) CLIENTES,
            MAX(M.QT) MAIOR_MOV
     FROM PCMOV M
     WHERE M.CODPROD=:c AND M.CODOPER='S' AND M.CODFILIAL IN (${FIL}) AND M.DTMOV>=TRUNC(SYSDATE)-90
     GROUP BY TRUNC(M.DTMOV,'IW') ORDER BY TRUNC(M.DTMOV,'IW')`, {c:COD}, opt);
  console.log('=== VENDAS POR SEMANA (filial 21, 90d) ==='); console.table(sem.rows);

  // Concentração: top movimentos individuais
  const top = await conn.execute(
    `SELECT * FROM (
       SELECT TO_CHAR(M.DTMOV,'DD/MM') DIA, M.CODCLI, M.QT, NVL(M.QTDEVOL,0) DEVOL
       FROM PCMOV M WHERE M.CODPROD=:c AND M.CODOPER='S' AND M.CODFILIAL IN (${FIL}) AND M.DTMOV>=TRUNC(SYSDATE)-30
       ORDER BY M.QT DESC) WHERE ROWNUM<=8`, {c:COD}, opt);
  console.log('=== MAIORES VENDAS (últimos 30d) ==='); console.table(top.rows);

  await conn.close(); await database.close();
})();
