require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');
const oracledb = require('oracledb');

async function main() {
    await initialize();
    const conn = await getConnection();
    
    try {
        console.log('Fetching all active Soft Works products from database...');
        const query = `
            SELECT 
                P.CODPROD,
                P.DESCRICAO,
                P.QTUNITCX,
                P.CODFORNEC,
                (SELECT FANTASIA FROM PCFORNEC WHERE CODFORNEC = P.CODFORNEC) AS FORNECEDOR,
                P.ALTURAM3,
                P.LARGURAM3,
                P.COMPRIMENTOM3,
                NVL((SELECT QTESTGER FROM PCEST WHERE CODPROD = P.CODPROD AND CODFILIAL = '20'), 0) AS ESTOQUE_20,
                NVL((SELECT QTESTGER - QTRESERV - QTBLOQUEADA FROM PCEST WHERE CODPROD = P.CODPROD AND CODFILIAL = '20'), 0) AS ESTOQUE_DISP_20
            FROM PCPRODUT P
            WHERE P.DTEXCLUSAO IS NULL
              AND P.CODFORNEC = 13232
            ORDER BY P.CODPROD ASC
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`Total Soft Works products found in database: ${result.rows.length}`);
        
        // Write the database products to a JSON file for analysis
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, 'softworks_db_products.json');
        fs.writeFileSync(outputPath, JSON.stringify(result.rows, null, 2), 'utf8');
        console.log(`Saved database products list to ${outputPath}`);
        
    } catch (err) {
        console.error('Error fetching Soft Works products:', err);
    } finally {
        await conn.close();
        await close();
    }
}

main();
