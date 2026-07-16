require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');
const oracledb = require('oracledb');

async function main() {
    await initialize();
    const conn = await getConnection();
    
    try {
        console.log('Querying PCPRODUT column names containing PESO...');
        const query = `
            SELECT COLUMN_NAME, OWNER 
            FROM ALL_TAB_COLUMNS 
            WHERE TABLE_NAME = 'PCPRODUT' 
              AND (COLUMN_NAME LIKE '%PESO%')
              AND ROWNUM <= 50
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.table(result.rows);
        
    } catch (err) {
        console.error('Error querying columns:', err);
    } finally {
        await conn.close();
        await close();
    }
}

main();
