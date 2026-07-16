require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');

async function test() {
    try {
        await initialize();
        const conn = await getConnection();
        
        console.log("=== RUNNING FIXED RECOMPRA SQL ===");
        const r1 = await conn.execute(`
            WITH VendasPeriodo AS (
              -- Busca todas as compras faturadas de produtos da Bom Princípio no período de campanha
              SELECT 
                f.CODFILIAL,
                f.CODUSUR,
                u.NOME AS NOME_RCA,
                f.CODCLI,
                MIN(f.DTSAIDA) AS DT_PRIMEIRA_COMPRA_PERIODO,
                -- Conta quantas compras (Notas Fiscais) distintas o cliente realizou do fornecedor 15500
                COUNT(DISTINCT f.NUMTRANSVENDA) AS TOTAL_COMPRAS
              FROM PCMOV m
              JOIN PCNFSAID f ON m.NUMTRANSVENDA = f.NUMTRANSVENDA
              JOIN PCPRODUT p ON p.CODPROD = m.CODPROD
              JOIN PCUSUARI u ON u.CODUSUR = f.CODUSUR
              WHERE f.DTCANCEL IS NULL
                AND m.CODOPER = 'S'
                AND f.CONDVENDA IN (1, 7, 9)
                -- Filtro pelo fornecedor Bom Princípio (15500)
                AND p.CODFORNEC = 15500
                -- Filtro da Filial Desejada (Substitua pela filial desejada, ex: '20')
                AND f.CODFILIAL = '20'
                AND f.CODUSUR <> 100
                AND u.NOME NOT LIKE '%BRAGO%'
                -- Filtro do período da campanha
                AND f.DTSAIDA BETWEEN TO_DATE('01/06/2026', 'DD/MM/YYYY') AND TO_DATE('30/08/2026', 'DD/MM/YYYY')
              GROUP BY f.CODFILIAL, f.CODUSUR, u.NOME, f.CODCLI
            ),

            ClientesSemCompraAnterior AS (
              -- Filtra apenas clientes que nunca compraram antes E que recompraram no período (total_compras >= 2)
              SELECT vp.*
              FROM VendasPeriodo vp
              WHERE vp.TOTAL_COMPRAS >= 2
                AND NOT EXISTS (
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
                )
            )

            -- Detalhamento final
            SELECT 
              r.CODFILIAL AS FILIAL,
              r.POSICAO_RANKING AS RANK,
              r.RCA,
              r.NOME_RCA AS VENDEDOR,
              c.CODCLI AS COD_CLIENTE,
              cl.CLIENTE AS NOME_CLIENTE,
              TO_CHAR(c.DT_PRIMEIRA_COMPRA_PERIODO, 'DD/MM/YYYY') AS DATA_ABERTURA,
              c.TOTAL_COMPRAS AS COMPRAS_NO_PERIODO
            FROM (
              SELECT CODFILIAL, CODUSUR AS RCA, NOME_RCA, COUNT(DISTINCT CODCLI) AS TOTAL_CLIENTES_ABERTOS,
                     DENSE_RANK() OVER (ORDER BY COUNT(DISTINCT CODCLI) DESC) AS POSICAO_RANKING
              FROM ClientesSemCompraAnterior
              GROUP BY CODFILIAL, CODUSUR, NOME_RCA
            ) r
            JOIN ClientesSemCompraAnterior c ON c.CODFILIAL = r.CODFILIAL AND c.CODUSUR = r.RCA
            JOIN PCCLIENT cl ON cl.CODCLI = c.CODCLI
            WHERE r.POSICAO_RANKING <= 3
            ORDER BY r.POSICAO_RANKING, r.TOTAL_CLIENTES_ABERTOS DESC, c.DT_PRIMEIRA_COMPRA_PERIODO ASC
        `);
        
        console.log("Results (Fixed):");
        console.table(r1.rows);
        
        await conn.close();
        await close();
    } catch(err) {
        console.error(err);
    }
}
test();
