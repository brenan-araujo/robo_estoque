require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');

async function test() {
    try {
        await initialize();
        const conn = await getConnection();
        
        console.log("=== EXECUTING POINTS RANKING QUERY ===");
        const r1 = await conn.execute(`
             WITH VendasPeriodo AS (
               SELECT 
                 f.CODFILIAL,
                 f.CODUSUR,
                 u.NOME AS NOME_RCA,
                 f.CODCLI,
                 MIN(f.DTSAIDA) AS DT_PRIMEIRA_COMPRA_PERIODO,
                 -- Limita a pontuação em no máximo 2 pontos por cliente (1 da abertura + 1 da 1ª recompra no período)
                 LEAST(COUNT(DISTINCT f.NUMTRANSVENDA), 2) AS PONTOS_CLIENTE
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
                 -- Deduções de devolução
                 AND (m.QT - NVL(m.QTDEVOL, 0)) > 0
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
               -- Clientes que nunca compraram antes de 01/06
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
 
             PontosPorVendedor AS (
               -- Soma os pontos de cada vendedor (limite de 2 pontos por cliente)
               SELECT 
                 CODFILIAL,
                 CODUSUR AS RCA,
                 NOME_RCA,
                 SUM(PONTOS_CLIENTE) AS TOTAL_PONTOS
               FROM ClientesSemCompraAnterior
               GROUP BY CODFILIAL, CODUSUR, NOME_RCA
             ),
 
             RankingVendedores AS (
               -- Ranking baseado nos pontos
               SELECT 
                 CODFILIAL,
                 RCA,
                 NOME_RCA,
                 TOTAL_PONTOS,
                 DENSE_RANK() OVER (ORDER BY TOTAL_PONTOS DESC) AS POSICAO_RANKING
               FROM PontosPorVendedor
             )

            SELECT 
              r.CODFILIAL AS FILIAL,
              r.POSICAO_RANKING AS RANK,
              r.RCA,
              r.NOME_RCA AS VENDEDOR,
              c.CODCLI AS COD_CLIENTE,
              cl.CLIENTE AS NOME_CLIENTE,
              TO_CHAR(c.DT_PRIMEIRA_COMPRA_PERIODO, 'DD/MM/YYYY') AS DATA_ABERTURA,
              c.PONTOS_CLIENTE AS PONTOS_CLIENTE,
              r.TOTAL_PONTOS AS PONTOS_TOTAIS_VENDEDOR
            FROM RankingVendedores r
            JOIN ClientesSemCompraAnterior c ON c.CODFILIAL = r.CODFILIAL AND c.CODUSUR = r.RCA
            JOIN PCCLIENT cl ON cl.CODCLI = c.CODCLI
            WHERE r.POSICAO_RANKING <= 3
            ORDER BY r.POSICAO_RANKING, r.TOTAL_PONTOS DESC, c.DT_PRIMEIRA_COMPRA_PERIODO ASC
        `);
        
        console.log("Points Results:");
        console.table(r1.rows);
        
        await conn.close();
        await close();
    } catch(err) {
        console.error(err);
    }
}
test();
