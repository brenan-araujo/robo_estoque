require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const all = async (sql,b)=> (await conn.execute(sql,b,opt)).rows;

  // 1. Realizado por fornecedor (julho MTD, RCA 93 / fil 20)
  const rf = await all(
    `SELECT P.CODFORNEC, F.FANTASIA, ROUND(SUM((M.QT-NVL(M.QTDEVOL,0))*M.PUNIT),2) V
     FROM PCMOV M JOIN PCPRODUT P ON P.CODPROD=M.CODPROD
     LEFT JOIN PCFORNEC F ON F.CODFORNEC=P.CODFORNEC
     WHERE M.CODUSUR=93 AND M.CODFILIAL='20' AND M.CODOPER='S'
       AND M.DTMOV>=TO_DATE('01/07/2026','DD/MM/YYYY') AND M.DTMOV<TRUNC(SYSDATE)+1
     GROUP BY P.CODFORNEC, F.FANTASIA ORDER BY V DESC FETCH FIRST 8 ROWS ONLY`, {});
  console.log('REALIZADO POR FORNECEDOR (jul MTD):'); console.table(rf);

  // 2. Curva A: Q2 por cliente (bruto NFSAID - devol ED por cliente)
  const q2 = await all(
    `SELECT N.CODCLI, NVL(C.FANTASIA, C.CLIENTE) NOME, ROUND(SUM(N.VLTOTAL),2) V
     FROM PCNFSAID N JOIN PCCLIENT C ON C.CODCLI=N.CODCLI
     WHERE N.CODUSUR=93 AND N.CODFILIAL='20' AND N.DTCANCEL IS NULL AND N.CONDVENDA IN (1,7,9,14)
       AND N.DTSAIDA>=TO_DATE('01/04/2026','DD/MM/YYYY') AND N.DTSAIDA<TO_DATE('30/06/2026','DD/MM/YYYY')+1
     GROUP BY N.CODCLI, NVL(C.FANTASIA, C.CLIENTE) ORDER BY V DESC`, {});
  const totQ2 = q2.reduce((a,r)=>a+Number(r.V),0);
  let acum=0; const curvaA=[];
  for (const r of q2){ if (acum/totQ2 < 0.8){ curvaA.push(r); acum+=Number(r.V); } }
  console.log(`\nCURVA A: ${curvaA.length} de ${q2.length} clientes | fat Q2 total ${totQ2.toFixed(2)}`);
  console.table(curvaA.slice(0,10).map(r=>({COD:r.CODCLI, NOME:String(r.NOME).slice(0,26), Q2:r.V, PART:(Number(r.V)/totQ2*100).toFixed(1)+'%'})));

  // 3. QTD atual (Q3 até hoje) dos clientes curva A
  const q3 = await all(
    `SELECT N.CODCLI, ROUND(SUM(N.VLTOTAL),2) V
     FROM PCNFSAID N
     WHERE N.CODUSUR=93 AND N.CODFILIAL='20' AND N.DTCANCEL IS NULL AND N.CONDVENDA IN (1,7,9,14)
       AND N.DTSAIDA>=TO_DATE('01/07/2026','DD/MM/YYYY') AND N.DTSAIDA<TRUNC(SYSDATE)+1
     GROUP BY N.CODCLI`, {});
  console.log('Clientes com compra no Q3 até hoje:', q3.length);

  // 4. Inativos da carteira (últ. compra por qualquer vendedor) por faixas
  const ina = await all(
    `SELECT C.CODCLI, NVL(C.FANTASIA, C.CLIENTE) NOME,
            TRUNC(SYSDATE) - TRUNC(MAX(N.DTSAIDA)) DIAS,
            ROUND(SUM(CASE WHEN N.DTSAIDA >= ADD_MONTHS(TRUNC(SYSDATE),-12) THEN N.VLTOTAL ELSE 0 END),2) V12M
     FROM PCCLIENT C JOIN PCNFSAID N ON N.CODCLI=C.CODCLI AND N.DTCANCEL IS NULL AND N.CONDVENDA IN (1,7,9,14)
     WHERE C.CODUSUR1=93
     GROUP BY C.CODCLI, NVL(C.FANTASIA, C.CLIENTE)
     HAVING TRUNC(SYSDATE) - TRUNC(MAX(N.DTSAIDA)) > 30
     ORDER BY V12M DESC`, {});
  const f1=ina.filter(r=>r.DIAS<=60), f2=ina.filter(r=>r.DIAS>60&&r.DIAS<=90), f3=ina.filter(r=>r.DIAS>90);
  console.log(`\nINATIVOS: 30-60d=${f1.length} | 60-90d=${f2.length} | +90d=${f3.length}`);
  console.log('Top 30-60d:'); console.table(f1.slice(0,5).map(r=>({COD:r.CODCLI,NOME:String(r.NOME).slice(0,24),DIAS:r.DIAS,V12M:r.V12M})));
  console.log('Top +90d:'); console.table(f3.slice(0,5).map(r=>({COD:r.CODCLI,NOME:String(r.NOME).slice(0,24),DIAS:r.DIAS,V12M:r.V12M})));

  await conn.close(); await database.close();
})();
