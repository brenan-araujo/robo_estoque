require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');
const oracledb = require('oracledb');

const searchTerms = [
    'BB50', 'BB51', 'BB60', 'BB61', 'BB65', 'BB66', 'BB67',
    'BB80', 'BB81', 'BB85', 'BB86', 'BB87', 'BB95'
];

async function main() {
    await initialize();
    const conn = await getConnection();
    
    try {
        console.log('Searching for BB products...');
        
        // Let's search where description or code contains our terms
        const conditions = searchTerms.map(term => `P.DESCRICAO LIKE '%${term}%' OR P.CODPROD LIKE '%${term}%'`).join(' OR ');
        
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
              AND (${conditions})
            ORDER BY P.CODPROD ASC
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`Found ${result.rows.length} products:`);
        console.table(result.rows);
    } catch (err) {
        console.error('Error running search query:', err);
    } finally {
        await conn.close();
        await close();
    }
}

main();
