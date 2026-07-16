const fetch = require('node-fetch-commonjs' in require('module').builtinModules ? 'node-fetch' : 'node-fetch');

async function test() {
    try {
        console.log("=== FETCHING CURRENT CAMPAIGNS ===");
        const getRes = await fetch('http://localhost:3001/api/campaigns');
        const getData = await getRes.json();
        
        if (!getData.success || getData.campaigns.length === 0) {
            console.error("No campaigns found!");
            return;
        }
        
        const originalCamp = getData.campaigns[0];
        console.log("Original Campaign Name:", originalCamp.name);
        console.log("Original selectQuery Length:", originalCamp.selectQuery.length);
        console.log("Original excelQuery:", originalCamp.excelQuery);

        const detailedQuery = `WITH VendasPeriodo AS (
  SELECT 
    f.CODFILIAL,
    f.CODUSUR,
    u.NOME AS NOME_RCA,
    f.CODCLI,
    f.NUMTRANSVENDA,
    f.NUMNOTA,
    f.DTSAIDA
  FROM PCMOV m
  JOIN PCNFSAID f ON m.NUMTRANSVENDA = f.NUMTRANSVENDA
  JOIN PCPRODUT p ON p.CODPROD = m.CODPROD
  JOIN PCUSUARI u ON u.CODUSUR = f.CODUSUR
  WHERE f.DTCANCEL IS NULL
    AND m.CODOPER = 'S'
    AND f.CONDVENDA IN (1, 7, 9)
    AND p.CODFORNEC = 15500
    AND f.CODFILIAL = '20'
    AND f.CODUSUR <> 100
    AND u.NOME NOT LIKE '%BRAGO%'
    AND f.DTSAIDA BETWEEN TO_DATE('01/06/2026', 'DD/MM/YYYY') AND TO_DATE('30/08/2026', 'DD/MM/YYYY')
    -- 🛡️ Dedução de devolução por item
    AND (m.QT - NVL(m.QTDEVOL, 0)) > 0
    -- 🛡️ Dedução de devolução total de nota
    AND NOT (
        NVL(f.VLTOTAL, 0) > 0
        AND (SELECT NVL(SUM(ne.VLTOTAL), 0)
               FROM PCNFENT ne
              WHERE ne.NUMTRANSVENDAORIG = f.NUMTRANSVENDA
                AND ne.DTCANCEL IS NULL) >= NVL(f.VLTOTAL, 0) * 0.999
    )
  GROUP BY f.CODFILIAL, f.CODUSUR, u.NOME, f.CODCLI, f.NUMTRANSVENDA, f.NUMNOTA, f.DTSAIDA
),

ClientesSemCompraAnterior AS (
  SELECT vp.*
  FROM VendasPeriodo vp
  WHERE NOT EXISTS (
    SELECT 1 
    FROM PCMOV m2
    JOIN PCNFSAID f2 ON m2.NUMTRANSVENDA = f2.NUMTRANSVENDA
    JOIN PCPRODUT p2 ON p2.CODPROD = m2.CODPROD
    WHERE f2.DTCANCEL IS NULL
      AND m2.CODOPER = 'S'
      AND f2.CONDVENDA IN (1, 7, 9)
      AND f2.CODCLI = vp.CODCLI
      AND p2.CODFORNEC = 15500
      AND f2.DTSAIDA < TO_DATE('01/06/2026', 'DD/MM/YYYY')
      AND (m2.QT - NVL(m2.QTDEVOL, 0)) > 0
      AND NOT (
          NVL(f2.VLTOTAL, 0) > 0
          AND (SELECT NVL(SUM(ne2.VLTOTAL), 0)
                 FROM PCNFENT ne2
                WHERE ne2.NUMTRANSVENDAORIG = f2.NUMTRANSVENDA
                  AND ne2.DTCANCEL IS NULL) >= NVL(f2.VLTOTAL, 0) * 0.999
      )
  )
),

ContagemComprasCliente AS (
  SELECT 
    CODFILIAL,
    CODUSUR,
    NOME_RCA,
    CODCLI,
    LEAST(COUNT(DISTINCT NUMTRANSVENDA), 2) AS PONTOS_CLIENTE
  FROM ClientesSemCompraAnterior
  GROUP BY CODFILIAL, CODUSUR, NOME_RCA, CODCLI
),

PontosPorVendedor AS (
  SELECT 
    CODFILIAL,
    CODUSUR AS RCA,
    NOME_RCA,
    SUM(PONTOS_CLIENTE) AS TOTAL_PONTOS
  FROM ContagemComprasCliente
  GROUP BY CODFILIAL, CODUSUR, NOME_RCA
),

RankingVendedores AS (
  SELECT 
    CODFILIAL,
    RCA,
    NOME_RCA,
    TOTAL_PONTOS,
    DENSE_RANK() OVER (ORDER BY TOTAL_PONTOS DESC) AS POSICAO_RANKING
  FROM PontosPorVendedor
),

DetalhamentoCompras AS (
  SELECT 
    r.CODFILIAL AS FILIAL,
    r.POSICAO_RANKING AS RANK,
    r.RCA AS COD_VENDEDOR,
    r.NOME_RCA AS VENDEDOR,
    c.CODCLI AS COD_CLIENTE,
    cl.CLIENTE AS NOME_CLIENTE,
    c.NUMNOTA AS NF_SAIDA,
    c.DTSAIDA AS DT_COMPRA,
    m_all.CODPROD AS COD_PRODUTO,
    p_all.DESCRICAO AS NOME_PRODUTO,
    (m_all.QT - NVL(m_all.QTDEVOL, 0)) AS QUANTIDADE,
    m_all.PUNIT AS PRECO_UNITARIO,
    DENSE_RANK() OVER (PARTITION BY c.CODCLI ORDER BY c.DTSAIDA, c.NUMTRANSVENDA) AS INVOICE_RANK,
    r.TOTAL_PONTOS AS PONTOS_TOTAIS_VENDEDOR
  FROM RankingVendedores r
  JOIN ClientesSemCompraAnterior c ON c.CODFILIAL = r.CODFILIAL AND c.CODUSUR = r.RCA
  JOIN PCCLIENT cl ON cl.CODCLI = c.CODCLI
  JOIN PCMOV m_all ON m_all.NUMTRANSVENDA = c.NUMTRANSVENDA
  JOIN PCPRODUT p_all ON p_all.CODPROD = m_all.CODPROD
  WHERE m_all.CODOPER = 'S'
    AND p_all.CODFORNEC = 15500
    AND (m_all.QT - NVL(m_all.QTDEVOL, 0)) > 0
)

SELECT 
  FILIAL,
  RANK,
  COD_VENDEDOR,
  VENDEDOR,
  COD_CLIENTE,
  NOME_CLIENTE,
  NF_SAIDA,
  TO_CHAR(DT_COMPRA, 'DD/MM/YYYY') AS DATA_COMPRA,
  COD_PRODUTO,
  NOME_PRODUTO,
  QUANTIDADE,
  PRECO_UNITARIO,
  CASE WHEN INVOICE_RANK = 1 THEN 'PRIMEIRA VENDA' ELSE 'RECOMPRA' END AS TIPO_VENDA,
  PONTOS_TOTAIS_VENDEDOR
FROM DetalhamentoCompras
ORDER BY RANK, PONTOS_TOTAIS_VENDEDOR DESC, NOME_CLIENTE, DT_COMPRA, COD_PRODUTO`;

        console.log("\n=== UPDATING CAMPAIGN WITH excelQuery ===");
        const updatePayload = {
            ...originalCamp,
            excelQuery: detailedQuery
        };
        
        const postRes = await fetch('http://localhost:3001/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload)
        });
        const postData = await postRes.json();
        
        if (!postData.success) {
            console.error("Update campaign failed:", postData.error);
            return;
        }
        console.log("Update success! New excelQuery saved.");
        
        // Fetch again to verify
        const getRes2 = await fetch('http://localhost:3001/api/campaigns');
        const getData2 = await getRes2.json();
        const updatedCamp = getData2.campaigns[0];
        console.log("Updated Campaign Name:", updatedCamp.name);
        console.log("Updated excelQuery exists:", !!updatedCamp.excelQuery);
        console.log("excelQuery starts with WITH:", updatedCamp.excelQuery.startsWith("WITH"));
        
        // Run Excel generation trigger
        console.log("\n=== TRIGGERING EXCEL DISPATCH ===");
        const triggerRes = await fetch(`http://localhost:3001/api/campaigns/${updatedCamp.id}/trigger-excel`, {
            method: 'POST'
        });
        const triggerData = await triggerRes.json();
        console.log("Trigger Excel response:", JSON.stringify(triggerData, null, 2));

    } catch (err) {
        console.error(err);
    }
}
test();
