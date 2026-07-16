require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');
const oracledb = require('oracledb');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const query = `
WITH VendasPeriodo AS (
  SELECT 
    f.CODFILIAL,
    f.CODUSUR,
    u.NOME AS NOME_RCA,
    f.CODCLI,
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
    AND f.CODUSUR <> 100
    AND u.NOME NOT LIKE '%BRAGO%'
    AND f.DTSAIDA BETWEEN TO_DATE('01/06/2026', 'DD/MM/YYYY') AND TO_DATE('30/08/2026', 'DD/MM/YYYY')
  GROUP BY f.CODFILIAL, f.CODUSUR, u.NOME, f.CODCLI, f.NUMTRANSVENDA, f.DTSAIDA
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
  )
),

ContagemComprasCliente AS (
  SELECT 
    CODFILIAL,
    CODUSUR,
    NOME_RCA,
    CODCLI,
    COUNT(DISTINCT NUMTRANSVENDA) AS TOTAL_COMPRAS
  FROM ClientesSemCompraAnterior
  GROUP BY CODFILIAL, CODUSUR, NOME_RCA, CODCLI
),

PontosPorVendedor AS (
  SELECT 
    CODFILIAL,
    CODUSUR AS RCA,
    NOME_RCA,
    SUM(TOTAL_COMPRAS) AS TOTAL_PONTOS
  FROM ContagemComprasCliente
  GROUP BY CODFILIAL, CODUSUR, NOME_RCA
),

RankingVendedores AS (
  SELECT 
    CODFILIAL,
    RCA,
    NOME_RCA,
    TOTAL_PONTOS,
    DENSE_RANK() OVER (PARTITION BY CODFILIAL ORDER BY TOTAL_PONTOS DESC) AS POSICAO_RANKING
  FROM PontosPorVendedor
)

SELECT 
  r.CODFILIAL AS FILIAL,
  r.POSICAO_RANKING AS RANK,
  r.RCA,
  r.NOME_RCA AS VENDEDOR,
  c.CODCLI AS COD_CLIENTE,
  cl.CLIENTE AS NOME_CLIENTE,
  c.NUMTRANSVENDA AS TRANSACAO_NOTA,
  TO_CHAR(c.DTSAIDA, 'DD/MM/YYYY') AS DATA_FATURAMENTO,
  m_all.CODPROD AS COD_PRODUTO,
  p_all.DESCRICAO AS NOME_PRODUTO,
  m_all.QT AS QUANTIDADE,
  m_all.PUNIT AS PRECO_UNITARIO,
  r.TOTAL_PONTOS AS PONTOS_TOTAIS_VENDEDOR
FROM RankingVendedores r
JOIN ClientesSemCompraAnterior c ON c.CODFILIAL = r.CODFILIAL AND c.CODUSUR = r.RCA
JOIN PCCLIENT cl ON cl.CODCLI = c.CODCLI
JOIN PCMOV m_all ON m_all.NUMTRANSVENDA = c.NUMTRANSVENDA
JOIN PCPRODUT p_all ON p_all.CODPROD = m_all.CODPROD
WHERE m_all.CODOPER = 'S'
  AND p_all.CODFORNEC = 15500
ORDER BY r.CODFILIAL, r.POSICAO_RANKING, r.TOTAL_PONTOS DESC, c.CODCLI, c.DTSAIDA ASC, m_all.CODPROD ASC
`;

async function main() {
    try {
        await initialize();
        const connection = await getConnection();
        
        console.log('Running query...');
        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = result.rows || [];
        const columns = result.metaData ? result.metaData.map(m => m.name) : [];
        
        console.log(`Query returned ${rows.length} rows and ${columns.length} columns.`);
        
        // Generate Excel file using exact sendCustomExcel logic
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Consulta SQL');
        
        worksheet.columns = columns.map(col => ({
            header: col,
            key: col,
            width: Math.max(col.length + 4, 15)
        }));
        
        const headerRow = worksheet.getRow(1);
        headerRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF5B21B6' } // Roxo/Purple matching the UI theme
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        
        rows.forEach(row => {
            worksheet.addRow(row);
        });
        
        worksheet.columns.forEach(column => {
            let maxLen = column.header.length;
            column.eachCell({ includeEmpty: true }, cell => {
                const val = cell.value;
                if (val !== null && val !== undefined) {
                    maxLen = Math.max(maxLen, String(val).length);
                }
            });
            column.width = Math.min(maxLen + 4, 50);
        });
        
        const outputPath = path.join(__dirname, 'test_custom_excel.xlsx');
        await workbook.xlsx.writeFile(outputPath);
        
        console.log(`Excel successfully written to ${outputPath}`);
        console.log('Validating columns:');
        console.log(columns);
        
        await connection.close();
        await close();
    } catch (err) {
        console.error('Error generating Excel:', err);
    }
}

main();
