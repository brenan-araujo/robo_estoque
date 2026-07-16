require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');

async function getColumns() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        const result = await connection.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCUSUARI'
             AND (COLUMN_NAME LIKE '%TEL%' 
                  OR COLUMN_NAME LIKE '%CEL%' 
                  OR COLUMN_NAME LIKE '%NOME%' 
                  OR COLUMN_NAME LIKE '%COD%' 
                  OR COLUMN_NAME LIKE '%FILIAL%'
                  OR COLUMN_NAME LIKE '%FONE%')
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        console.log('=== PCUSUARI Filtered Columns ===');
        result.rows.forEach(r => {
            console.log(`${r.COLUMN_NAME} (${r.DATA_TYPE})`);
        });

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

getColumns();
