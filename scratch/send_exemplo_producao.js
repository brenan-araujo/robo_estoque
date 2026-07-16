require('dotenv').config();
const http = require('http');
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

// Lógica de PRODUÇÃO (relatório de sexta): venda diária ponderada por recência + líquida
// de devoluções, SEM as seções de personalização. (Winsorização continua parqueada.)
const SQL = `
WITH VENDAS AS (
  SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END FIL,
    COUNT(DISTINCT TRUNC(M.DTMOV)) DIAS,
    ROUND(GREATEST((
        3*SUM(CASE WHEN M.DTMOV>=TRUNC(SYSDATE)-30 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END)
      + 2*SUM(CASE WHEN M.DTMOV<TRUNC(SYSDATE)-30 AND M.DTMOV>=TRUNC(SYSDATE)-60 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END)
      + 1*SUM(CASE WHEN M.DTMOV<TRUNC(SYSDATE)-60 THEN M.QT-NVL(M.QTDEVOL,0) ELSE 0 END)
    )/180,0),2) VENDA_DIA
  FROM PCMOV M WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-90 AND M.CODFILIAL IN ('6','20','21','22','23')
  GROUP BY M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END
),
DET AS (
  SELECT V.CODPROD, V.FIL, P.DESCRICAO, P.EMBALAGEM, P.UNIDADE, FORN.FANTASIA FORNEC,
    NVL(FORN.PRAZOENTREGA,7) PRAZO, V.VENDA_DIA,
    (SELECT NVL(SUM(NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)),0) FROM PCEST E
       WHERE E.CODPROD=V.CODPROD AND ((V.FIL='20' AND E.CODFILIAL IN ('20','6')) OR (V.FIL<>'20' AND E.CODFILIAL=V.FIL))) ESTOQUE,
    (SELECT NVL(SUM(NVL(I.QTPEDIDA,0)-NVL(I.QTENTREGUE,0)),0) FROM PCITEM I JOIN PCPEDIDO PE ON I.NUMPED=PE.NUMPED
       WHERE I.CODPROD=V.CODPROD AND (I.QTPEDIDA-NVL(I.QTENTREGUE,0))>0 AND PE.DTPREVENT>=TRUNC(SYSDATE) AND PE.DTENTRADAESTOQUE IS NULL
         AND ((V.FIL='20' AND PE.CODFILIAL IN ('20','6')) OR (V.FIL<>'20' AND PE.CODFILIAL=V.FIL))) SALDO
  FROM VENDAS V JOIN PCPRODUT P ON P.CODPROD=V.CODPROD
    LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC=P.CODFORNEC
  WHERE P.REVENDA='S' AND P.CODEPTO IN (1,2,3,7)
    AND P.CODFORNEC NOT IN (3,4,14566,14631,14574,14573) AND NVL(P.OBS2,' ')<>'FL'
    AND P.CODSEC NOT IN (14,17,20,24,42,10000,10001,10041)
    AND V.DIAS>=5
)
SELECT
  FORNEC AS "Fornecedor",
  CASE WHEN FIL='20' THEN '20 + 6' ELSE FIL END AS "Filial",
  CODPROD AS "Codigo",
  DESCRICAO||' ('||EMBALAGEM||' '||UNIDADE||')' AS "Descricao",
  VENDA_DIA AS "Venda Dia",
  ESTOQUE AS "Estoque",
  SALDO AS "Saldo Pedido",
  PRAZO AS "Prazo Forn",
  CASE WHEN VENDA_DIA>0 THEN ROUND(ESTOQUE/VENDA_DIA,1) END AS "Cobertura (dias)",
  CASE
    WHEN NVL(VENDA_DIA,0)<=0 THEN 'SAUDAVEL'
    WHEN ESTOQUE/VENDA_DIA >= PRAZO THEN 'SAUDAVEL'
    WHEN (ESTOQUE+SALDO)/VENDA_DIA < PRAZO THEN 'CRITICO'
    ELSE 'ATENCAO' END AS "Status",
  CASE
    WHEN NVL(VENDA_DIA,0)>0 AND (ESTOQUE+SALDO)/VENDA_DIA < PRAZO THEN
      CASE WHEN ESTOQUE=0 THEN GREATEST(1, CEIL(VENDA_DIA*PRAZO-(ESTOQUE+SALDO)))
           ELSE GREATEST(0, ROUND(VENDA_DIA*PRAZO-(ESTOQUE+SALDO))) END
    ELSE 0 END AS "Sugestao Compra"
FROM DET
ORDER BY
  CASE
    WHEN VENDA_DIA>0 AND (ESTOQUE+SALDO)/VENDA_DIA<PRAZO AND ESTOQUE/VENDA_DIA<PRAZO THEN 0
    WHEN VENDA_DIA>0 AND ESTOQUE/VENDA_DIA<PRAZO THEN 1 ELSE 2 END,
  FORNEC, "Filial"`;

async function test() {
  await database.initialize();
  const conn = await database.getConnection();
  const r = await conn.execute(SQL, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  console.log(`Linhas: ${r.rows.length}`);
  console.log('Colunas:', r.metaData.map(m=>m.name).join(' | '));
  // confere que não há item de personalização (CODSEC) — implícito; mostra status counts
  const cnt={}; r.rows.forEach(x=>cnt[x.Status]=(cnt[x.Status]||0)+1);
  console.log('Status:', cnt);
  r.rows.slice(0,5).forEach(x=>console.log(`  ${x.Codigo}/${x.Filial} ${x.Status} | vda ${x['Venda Dia']} est ${x.Estoque} sug ${x['Sugestao Compra']}`));
  await conn.close(); await database.close();
}
function send() {
  const payload = JSON.stringify({
    selectQuery: SQL, recipients: '5562996101684',
    caption: '📊 *Relatório de Compras — exemplo (sem seções de personalização)*\n\nLógica de produção: venda diária ponderada por recência + líquida de devoluções, e SEM as seções de PERSONALIZAÇÃO. Enviado para validação.'
  });
  const req = http.request({ host:'localhost', port:3001, path:'/api/campaigns/send-custom-excel',
    method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)} },
    res=>{ let b=''; res.on('data',d=>b+=d); res.on('end',()=>console.log(`HTTP ${res.statusCode}: ${b}`)); });
  req.on('error',e=>console.error('Erro POST:',e.message));
  req.write(payload); req.end();
}
(process.argv[2]==='send'?send():test());
