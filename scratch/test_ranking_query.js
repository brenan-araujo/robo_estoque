require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');

async function test() {
    try {
        await initialize();
        const conn = await getConnection();
        
        console.log("=== EXECUTING SINGLE FILIAL (20) RANKING QUERY ===");
        const r1 = await conn.execute(`
            WITH VendasPeriodo AS (
              SELECT 
                f.CODFILIAL,
                f.CODUSUR,
                u.NOME AS NOME_RCA,
                f.CODCLI,
                MIN(f.DTSAIDA) AS DT_PRIMEIRA_COMPRA_PERIODO
              FROM PCMOV m
              JOIN PCNFSAID f ON m.NUMTRANSVENDA = f.NUMTRANSVENDA
              JOIN PCPRODUT p ON p.CODPROD = m.CODPROD
              JOIN PCUSUARI u ON u.CODUSUR = f.CODUSUR
              WHERE f.DTCANCEL IS NULL
                AND m.CODOPER = 'S'
                AND f.CONDVENDA IN (1, 7, 9)
                AND p.CODFORNEC = 15500
                -- Filtro da Filial Desejada
                AND f.CODFILIAL = '20'
                AND f.CODUSUR <> 100
                AND u.NOME NOT LIKE '%BRAGO%'
                AND f.DTSAIDA BETWEEN TO_DATE('01/06/2026', 'DD/MM/YYYY') AND TO_DATE('30/08/2026', 'DD/MM/YYYY')
                -- 1) Dedução de devolução por item (PCMOV.QTDEVOL): garante que o item não foi totalmente devolvido
                AND (m.QT - NVL(m.QTDEVOL, 0)) > 0
                -- 2) Dedução de devolução total da NF por entrada (PCNFENT): garante que o valor faturado da NF não foi devolvido
                AND NOT (
                    NVL(f.VLTOTAL, 0) > 0
                    AND (SELECT NVL(SUM(ne.VLTOTAL), 0)
                           FROM PCNFENT ne
                          WHERE ne.NUMTRANSVENDAORIG = f.NUMTRANSVENDA
                            AND ne.DTCANCEL IS NULL) >= NVL(f.VLTOTAL, 0) * 0.999
                )
              GROUP BY f.CODFILIAL, f.CODUSUR, u.NOME, f.CODCLI
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
                  -- Também deduz devoluções no histórico para não considerar compras devolvidas do passado como "compra válida"
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

            ContagemPorVendedor AS (
              SELECT 
                CODFILIAL,
                CODUSUR AS RCA,
                NOME_RCA,
                COUNT(DISTINCT CODCLI) AS TOTAL_CLIENTES_ABERTOS
              FROM ClientesSemCompraAnterior
              GROUP BY CODFILIAL, CODUSUR, NOME_RCA
            ),

            RankingVendedores AS (
              SELECT 
                CODFILIAL,
                RCA,
                NOME_RCA,
                TOTAL_CLIENTES_ABERTOS,
                DENSE_RANK() OVER (ORDER BY TOTAL_CLIENTES_ABERTOS DESC) AS POSICAO_RANKING
              FROM ContagemPorVendedor
            )

            SELECT 
              CODFILIAL AS FILIAL,
              POSICAO_RANKING AS RANK,
              RCA,
              NOME_RCA AS VENDEDOR,
              TOTAL_CLIENTES_ABERTOS AS QTD_CLIENTES
            FROM RankingVendedores
            WHERE POSICAO_RANKING <= 3
            ORDER BY POSICAO_RANKING, TOTAL_CLIENTES_ABERTOS DESC
        `);
        
        console.log("Query Results for Filial 20:");
        console.table(r1.rows);
        
        await conn.close();
        await close();
    } catch(err) {
        console.error(err);
    }
}
test();
