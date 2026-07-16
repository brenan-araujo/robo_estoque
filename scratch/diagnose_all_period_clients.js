require('dotenv').config({ path: 'c:/Users/usuario001/Documents/api_consulta_estoque/.env' });
const { initialize, getConnection, close } = require('c:/Users/usuario001/Documents/api_consulta_estoque/src/config/database');

async function main() {
    try {
        await initialize();
        const conn = await getConnection();

        console.log("=== RUNNING DETAILED LOGIC DIAGNOSIS ===");
        
        // Get ALL clients who purchased supplier 15500 in filial 20 during the period
        const query = `
            WITH CompraSemana AS (
              SELECT 
                f.CODCLI,
                f.CODUSUR,
                f.NUMTRANSVENDA,
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
                -- Dedução por item
                AND (m.QT - NVL(m.QTDEVOL, 0)) > 0
                -- Dedução total nota
                AND NOT (
                    NVL(f.VLTOTAL, 0) > 0
                    AND (SELECT NVL(SUM(ne.VLTOTAL), 0)
                           FROM PCNFENT ne
                          WHERE ne.NUMTRANSVENDAORIG = f.NUMTRANSVENDA
                            AND ne.DTCANCEL IS NULL) >= NVL(f.VLTOTAL, 0) * 0.999
                )
              GROUP BY f.CODCLI, f.CODUSUR, f.NUMTRANSVENDA, f.DTSAIDA
            )
            SELECT 
                cs.CODCLI,
                cl.CLIENTE,
                cs.CODUSUR,
                u.NOME AS VENDEDOR,
                COUNT(DISTINCT cs.NUMTRANSVENDA) AS QTD_TX_PERIODO,
                
                -- Prior purchase check (with return filter)
                (SELECT COUNT(DISTINCT f2.NUMTRANSVENDA)
                 FROM PCMOV m2
                 JOIN PCNFSAID f2 ON m2.NUMTRANSVENDA = f2.NUMTRANSVENDA
                 JOIN PCPRODUT p2 ON p2.CODPROD = m2.CODPROD
                 WHERE f2.DTCANCEL IS NULL
                   AND m2.CODOPER = 'S'
                   AND f2.CONDVENDA IN (1, 7, 9)
                   AND f2.CODCLI = cs.CODCLI
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
                ) AS QTD_COMPRAS_ANTERIORES_VALIDAS
            FROM CompraSemana cs
            JOIN PCCLIENT cl ON cl.CODCLI = cs.CODCLI
            JOIN PCUSUARI u ON u.CODUSUR = cs.CODUSUR
            GROUP BY cs.CODCLI, cl.CLIENTE, cs.CODUSUR, u.NOME
            ORDER BY u.NOME, cl.CLIENTE
        `;

        const result = await conn.execute(query);
        const rows = result.rows || [];
        
        console.log("\nFound " + rows.length + " unique client-vendedor relations in the period.");
        
        const tableData = rows.map(row => {
            const codCli = row[0];
            const cliente = row[1];
            const codUsur = row[2];
            const vendedor = row[3];
            const txPeriodo = row[4];
            const comprasAntigasValidas = row[5];
            
            let status = "";
            let pontos = 0;
            
            if (comprasAntigasValidas > 0) {
                status = "EXCLUIDO (Compra anterior)";
                pontos = 0;
            } else {
                status = "ELEGIVEL (Novo)";
                pontos = Math.min(txPeriodo, 2);
            }
            
            return {
                "Vendedor": vendedor,
                "Cod_RCA": codUsur,
                "Cod_Cliente": codCli,
                "Cliente": cliente.substring(0, 25),
                "Compras_Periodo": txPeriodo,
                "Comp_Antigas_Validas": comprasAntigasValidas,
                "Status": status,
                "Pontos": pontos
            };
        });
        
        console.table(tableData);
        
        // Sum total points per seller according to eligibility
        const summary = {};
        tableData.forEach(item => {
            if (item.Status.startsWith("ELEGIVEL")) {
                const v = item.Vendedor;
                summary[v] = (summary[v] || 0) + item.Pontos;
            }
        });
        
        console.log("\n=== SUMMARY OF ELIGIBLE POINTS PER SELLER ===");
        console.table(Object.entries(summary).map(([v, p]) => ({ "Vendedor": v, "Pontos": p })).sort((a,b) => b["Pontos"] - a["Pontos"]));

        await conn.close();
        await close();
    } catch (err) {
        console.error(err);
    }
}

main();
