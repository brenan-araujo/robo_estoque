require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');

async function getEmailColumns() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        const result = await connection.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCUSUARI'
             ORDER BY COLUMN_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        console.log('=== PCUSUARI Columns ===');
        let emailCols = [];
        result.rows.forEach(r => {
            if (r.COLUMN_NAME.includes('EMAIL') || r.COLUMN_NAME.includes('MAIL')) {
                emailCols.push(r);
            }
        });
        
        if (emailCols.length > 0) {
            console.log('Found Email-related columns:');
            emailCols.forEach(col => {
                console.log(`- ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
            });
        } else {
            console.log('No Email-related columns found in PCUSUARI.');
            console.log('Listing first 20 columns:');
            result.rows.slice(0, 20).forEach(r => {
                console.log(`- ${r.COLUMN_NAME} (${r.DATA_TYPE})`);
            });
        }

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

getEmailColumns();
