require('dotenv').config();
const http = require('http');
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

// Nova lógica inteira em SQL: winsorização (P90 do dia) + classificação de perfil
// + cobertura/status/sugestão. Filial 6 consolidada na 20.
const SQL = `
WITH MOV AS (
  SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END FIL,
         TRUNC(M.DTMOV) DT, M.QT-NVL(M.QTDEVOL,0) QNET, M.CODCLI
  FROM PCMOV M WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-90
    AND M.CODFILIAL IN ('6','20','21','22','23')
),
DIA AS (
  SELECT CODPROD, FIL, DT, SUM(QNET) DIA_NET,
    CASE WHEN DT>=TRUNC(SYSDATE)-30 THEN 3 WHEN DT>=TRUNC(SYSDATE)-60 THEN 2 ELSE 1 END W
  FROM MOV GROUP BY CODPROD, FIL, DT
),
CAPS AS (
  SELECT CODPROD, FIL, PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY DIA_NET) CAP
  FROM DIA GROUP BY CODPROD, FIL
),
CLI AS ( SELECT CODPROD, FIL, COUNT(DISTINCT CODCLI) NCLI FROM MOV GROUP BY CODPROD, FIL ),
AGG AS (
  SELECT D.CODPROD, D.FIL, COUNT(*) DIAS, SUM(D.DIA_NET) TOT, MAX(D.DIA_NET) MAIOR_DIA,
    ROUND(SUM(D.W*D.DIA_NET)/180,2) VDA_ATUAL,
    ROUND(SUM(D.W*LEAST(D.DIA_NET,C.CAP))/180,2) VDA_WINSOR
  FROM DIA D JOIN CAPS C ON C.CODPROD=D.CODPROD AND C.FIL=D.FIL
  GROUP BY D.CODPROD, D.FIL
),
DET AS (
  SELECT A.CODPROD, A.FIL, P.DESCRICAO, P.EMBALAGEM, P.UNIDADE,
    FORN.FANTASIA FORNEC, NVL(FORN.PRAZOENTREGA,7) PRAZO, A.DIAS, CL.NCLI, A.TOT,
    ROUND(A.MAIOR_DIA/NULLIF(A.TOT,0)*100) PICO,
    A.VDA_ATUAL, A.VDA_WINSOR,
    (SELECT NVL(SUM(NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)),0) FROM PCEST E
       WHERE E.CODPROD=A.CODPROD AND ((A.FIL='20' AND E.CODFILIAL IN ('20','6')) OR (A.FIL<>'20' AND E.CODFILIAL=A.FIL))) ESTOQUE,
    (SELECT NVL(SUM(NVL(I.QTPEDIDA,0)-NVL(I.QTENTREGUE,0)),0) FROM PCITEM I JOIN PCPEDIDO PE ON I.NUMPED=PE.NUMPED
       WHERE I.CODPROD=A.CODPROD AND (I.QTPEDIDA-NVL(I.QTENTREGUE,0))>0 AND PE.DTPREVENT>=TRUNC(SYSDATE) AND PE.DTENTRADAESTOQUE IS NULL
         AND ((A.FIL='20' AND PE.CODFILIAL IN ('20','6')) OR (A.FIL<>'20' AND PE.CODFILIAL=A.FIL))) SALDO
  FROM AGG A JOIN PCPRODUT P ON P.CODPROD=A.CODPROD
    JOIN CLI CL ON CL.CODPROD=A.CODPROD AND CL.FIL=A.FIL
    LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC=P.CODFORNEC
  WHERE P.REVENDA='S' AND P.CODEPTO IN (1,2,3,7)
    AND P.CODFORNEC NOT IN (3,4,14566,14631,14574,14573) AND NVL(P.OBS2,' ')<>'FL'
    AND A.DIAS>=5 AND A.TOT>0
),
FINAL AS (
  SELECT D.*,
    CASE WHEN DIAS<8 OR NCLI=1 OR PICO>=70 THEN 'SOB DEMANDA'
         WHEN PICO>=40 THEN 'IRREGULAR' ELSE 'CONTINUO' END PERFIL
  FROM DET D
),
CALC AS (
  SELECT F.*,
    CASE WHEN PERFIL='SOB DEMANDA' THEN NULL
         WHEN PERFIL='IRREGULAR' THEN VDA_WINSOR ELSE VDA_ATUAL END VDA_USADA
  FROM FINAL F
)
SELECT
  FORNEC                                    AS "Fornecedor",
  FIL                                       AS "Filial",
  CODPROD                                   AS "Codigo",
  DESCRICAO || ' (' || EMBALAGEM || ' ' || UNIDADE || ')' AS "Descricao",
  PERFIL                                    AS "Perfil",
  DIAS                                      AS "Dias com Venda",
  NCLI                                      AS "Clientes",
  PICO                                      AS "Pico %",
  VDA_ATUAL                                 AS "Venda Dia (atual)",
  VDA_USADA                                 AS "Venda Dia (usada)",
  ESTOQUE                                   AS "Estoque",
  SALDO                                     AS "Saldo Pedido",
  PRAZO                                     AS "Prazo Forn",
  CASE WHEN VDA_USADA>0 THEN ROUND(ESTOQUE/VDA_USADA,1) END AS "Cobertura (dias)",
  CASE
    WHEN PERFIL='SOB DEMANDA' THEN 'REVISAR'
    WHEN NVL(VDA_USADA,0)<=0 THEN 'SAUDAVEL'
    WHEN ESTOQUE/VDA_USADA >= PRAZO THEN 'SAUDAVEL'
    WHEN (ESTOQUE+SALDO)/VDA_USADA < PRAZO THEN 'CRITICO'
    ELSE 'ATENCAO' END                      AS "Status",
  CASE
    WHEN PERFIL='SOB DEMANDA' THEN NULL
    WHEN NVL(VDA_USADA,0)>0 AND (ESTOQUE+SALDO)/VDA_USADA < PRAZO THEN
      CASE WHEN ESTOQUE=0 THEN GREATEST(1, CEIL(VDA_USADA*PRAZO-(ESTOQUE+SALDO)))
           ELSE GREATEST(0, ROUND(VDA_USADA*PRAZO-(ESTOQUE+SALDO))) END
    ELSE 0 END                              AS "Sugestao Compra",
  ROUND(TOT)                                AS "Volume 90d"
FROM CALC
ORDER BY
  CASE
    WHEN PERFIL='SOB DEMANDA' THEN 3
    WHEN VDA_USADA>0 AND (ESTOQUE+SALDO)/VDA_USADA < PRAZO AND ESTOQUE/VDA_USADA < PRAZO THEN 0
    WHEN VDA_USADA>0 AND ESTOQUE/VDA_USADA < PRAZO THEN 1
    ELSE 2 END,
  TOT DESC`;

async function test() {
    await database.initialize();
    const conn = await database.getConnection();
    const r = await conn.execute(SQL, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`Linhas: ${r.rows.length}`);
    console.log('Colunas:', r.metaData.map(m => m.name).join(' | '));
    console.log('\nPrimeiras 5 linhas (críticos no topo):');
    r.rows.slice(0, 5).forEach(x => console.log(`  ${x.Codigo}/${x.Filial} ${x.Perfil} | VDA ${x['Venda Dia (usada)']} | est ${x.Estoque} | ${x.Status} | sug ${x['Sugestao Compra']}`));
    await conn.close();
    await database.close();
}

function send() {
    const payload = JSON.stringify({
        selectQuery: SQL,
        recipients: '5562996101684',
        caption: '📊 *Relatório de Compras — NOVA LÓGICA (teste)*\n\nClassificação de perfil (Contínuo / Irregular / Sob Demanda) + venda diária com pico winsorizado e líquida de devoluções. Itens "SOB DEMANDA" aparecem como REVISAR (sem sugestão automática). Enviado só para validação.'
    });
    const req = http.request({
        host: 'localhost', port: 3001, path: '/api/campaigns/send-custom-excel',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
        let body = ''; res.on('data', d => body += d);
        res.on('end', () => console.log(`HTTP ${res.statusCode}: ${body}`));
    });
    req.on('error', e => console.error('Erro POST:', e.message));
    req.write(payload); req.end();
}

const mode = process.argv[2];
if (mode === 'send') send();
else test();
