require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');
const oracledb = require('oracledb');

async function main() {
    await initialize();
    const conn = await getConnection();
    
    try {
        console.log('Querying samples from PCPRODUT to find NCM...');
        const query = `
            SELECT CODPROD, DESCRICAO, CODFISCAL, CLASSIFICFISCAL, CODNCMEX
            FROM PCPRODUT
            WHERE CODFORNEC = 13232 AND ROWNUM <= 5
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.table(result.rows);
        
    } catch (err) {
        console.error('Error querying samples:', err);
    } finally {
        await conn.close();
        await close();
    }
}

main();
