require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== EXECULTANDO DETALHAMENTO DE COMPRAS COM TIPO DE VENDA ===');
        const res = await conn.execute(
            `WITH VendasPeriodo AS (
              -- 1. Busca todas as compras faturadas do fornecedor no período da campanha
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
              -- 2. Filtra apenas clientes que NUNCA compraram esse fornecedor antes do período da campanha
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
                  -- Dedução de devolução no histórico
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
              -- 3. Conta transações por cliente para calcular os pontos (capado em 2)
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
              -- 4. Calcula a soma total de pontos de cada vendedor
              SELECT 
                CODFILIAL,
                CODUSUR AS RCA,
                NOME_RCA,
                SUM(PONTOS_CLIENTE) AS TOTAL_PONTOS
              FROM ContagemComprasCliente
              GROUP BY CODFILIAL, CODUSUR, NOME_RCA
            ),

            RankingVendedores AS (
              -- 5. Classifica os vendedores
              SELECT 
                CODFILIAL,
                RCA,
                NOME_RCA,
                TOTAL_PONTOS,
                DENSE_RANK() OVER (ORDER BY TOTAL_PONTOS DESC) AS POSICAO_RANKING
              FROM PontosPorVendedor
            ),

            DetalhamentoCompras AS (
              -- 6. Une os clientes novos com suas compras de itens específicas no período
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
                -- Numerador de transações cronológicas por cliente para classificar 1ª venda vs Recompra
                DENSE_RANK() OVER (PARTITION BY c.CODCLI ORDER BY c.DTSAIDA, c.NUMTRANSVENDA) AS INVOICE_RANK,
                r.TOTAL_PONTOS AS PONTOS_TOTAIS_VENDEDOR
              FROM RankingVendedores r
              JOIN ClientesSemCompraAnterior c ON c.CODFILIAL = r.CODFILIAL AND c.CODUSUR = r.RCA
              JOIN PCCLIENT cl ON cl.CODCLI = c.CODCLI
              JOIN PCMOV m_all ON m_all.NUMTRANSVENDA = c.NUMTRANSVENDA
              JOIN PCPRODUT p_all ON p_all.CODPROD = m_all.CODPROD
              WHERE m_all.CODOPER = 'S'
                AND p_all.CODFORNEC = 15500
                AND (m_all.QT - NVL(m_all.QTDEVOL, 0)) > 0 -- Garante que o item específico não foi devolvido
            )

            -- 7. Exibe o resultado final com a classificação detalhada
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
            WHERE RANK <= 3
            ORDER BY RANK, PONTOS_TOTAIS_VENDEDOR DESC, NOME_CLIENTE, DT_COMPRA, COD_PRODUTO
            FETCH FIRST 30 ROWS ONLY`,
            [], opt
        );
        console.table(res.rows);

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
