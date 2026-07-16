require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const PRODS = '18604,18179,17475,17815,7120,12432';
  const q = await conn.execute(
   `WITH MOV AS (
      SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END FIL,
             TRUNC(M.DTMOV) DT, M.QT-NVL(M.QTDEVOL,0) QNET, M.CODCLI
      FROM PCMOV M WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-90
        AND M.CODFILIAL IN ('6','20','21','22','23') AND M.CODPROD IN (${PRODS})
    ),
    DIA AS (
      SELECT CODPROD, FIL, DT, SUM(QNET) DIA_NET,
        CASE WHEN DT>=TRUNC(SYSDATE)-30 THEN 3 WHEN DT>=TRUNC(SYSDATE)-60 THEN 2 ELSE 1 END W
      FROM MOV GROUP BY CODPROD, FIL, DT
    ),
    CAPS AS (
      SELECT CODPROD, FIL, ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY DIA_NET),1) CAP
      FROM DIA GROUP BY CODPROD, FIL
    ),
    CLI AS ( SELECT CODPROD, FIL, COUNT(DISTINCT CODCLI) NCLI FROM MOV GROUP BY CODPROD, FIL ),
    AGG AS (
      SELECT D.CODPROD, D.FIL, COUNT(*) DIAS, SUM(D.DIA_NET) TOT, MAX(D.DIA_NET) MAIOR_DIA, C.CAP,
        ROUND(SUM(D.W*D.DIA_NET)/180,2) VDA_ATUAL,
        ROUND(SUM(D.W*LEAST(D.DIA_NET,C.CAP))/180,2) VDA_WINSOR
      FROM DIA D JOIN CAPS C ON C.CODPROD=D.CODPROD AND C.FIL=D.FIL
      GROUP BY D.CODPROD, D.FIL, C.CAP
    )
    SELECT A.CODPROD, A.FIL, SUBSTR(P.DESCRICAO,1,24) DESCR, A.DIAS, CL.NCLI,
      ROUND(A.MAIOR_DIA/NULLIF(A.TOT,0),2) PICO,
      A.VDA_ATUAL, A.VDA_WINSOR, NVL(F.PRAZOENTREGA,7) PRAZO,
      (SELECT NVL(SUM(NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)),0) FROM PCEST E
         WHERE E.CODPROD=A.CODPROD AND ((A.FIL='20' AND E.CODFILIAL IN ('20','6')) OR (A.FIL<>'20' AND E.CODFILIAL=A.FIL))) ESTOQUE,
      (SELECT NVL(SUM(NVL(I.QTPEDIDA,0)-NVL(I.QTENTREGUE,0)),0) FROM PCITEM I JOIN PCPEDIDO PE ON I.NUMPED=PE.NUMPED
         WHERE I.CODPROD=A.CODPROD AND (I.QTPEDIDA-NVL(I.QTENTREGUE,0))>0 AND PE.DTPREVENT>=TRUNC(SYSDATE) AND PE.DTENTRADAESTOQUE IS NULL
           AND ((A.FIL='20' AND PE.CODFILIAL IN ('20','6')) OR (A.FIL<>'20' AND PE.CODFILIAL=A.FIL))) SALDO
    FROM AGG A JOIN PCPRODUT P ON P.CODPROD=A.CODPROD
      JOIN CLI CL ON CL.CODPROD=A.CODPROD AND CL.FIL=A.FIL
      LEFT JOIN BRAGO.PCFORNEC F ON F.CODFORNEC=P.CODFORNEC
    ORDER BY A.CODPROD`, [], opt);

  // classificação + sugestões
  const tier = (r)=>{
    if (r.DIAS < 8 || r.NCLI === 1 || r.PICO >= 0.70) return 'SOB_DEMANDA';
    if (r.PICO >= 0.40) return 'IRREGULAR';
    return 'CONTINUO';
  };
  const sug = (vda,prazo,est,saldo)=>Math.max(0, Math.round(vda*prazo - (est+saldo)));
  const out = q.rows.map(r=>{
    const t = tier(r);
    const sugAtual = sug(r.VDA_ATUAL, r.PRAZO, r.ESTOQUE, r.SALDO);
    let vdaNovo, sugNovo;
    if (t==='SOB_DEMANDA'){ vdaNovo='—'; sugNovo='REVISAR'; }
    else if (t==='IRREGULAR'){ vdaNovo=r.VDA_WINSOR; sugNovo=sug(r.VDA_WINSOR,r.PRAZO,r.ESTOQUE,r.SALDO); }
    else { vdaNovo=r.VDA_ATUAL; sugNovo=sug(r.VDA_ATUAL,r.PRAZO,r.ESTOQUE,r.SALDO); }
    return { COD:r.COD||r.CODPROD, FIL:r.FIL, DESCR:r.DESCR, DIAS:r.DIAS, NCLI:r.NCLI, PICO:r.PICO,
             EST:r.ESTOQUE, PRAZO:r.PRAZO, VDA_ATUAL:r.VDA_ATUAL, SUG_ATUAL:sugAtual,
             PERFIL:t, VDA_NOVO:vdaNovo, SUG_NOVO:sugNovo };
  });
  console.table(out);
  await conn.close(); await database.close();
})();
