require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Querying columns of PCCORTEI...');
        const colsResult = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCCORTEI'
             ORDER BY COLUMN_ID`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(colsResult.rows);

        console.log('\nQuerying recent records from PCCORTEI...');
        const recordsResult = await conn.execute(
            `SELECT * FROM (
                SELECT DTCORTE, NUMPED, CODPROD, QTFALTA, CODUSUR 
                FROM BRAGO.PCCORTEI 
                ORDER BY DTCORTE DESC
             ) WHERE ROWNUM <= 5`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(recordsResult.rows);
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
