require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Querying columns containing "FALTA" in any schema...');
        const result = await conn.execute(
            `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE COLUMN_NAME LIKE '%FALTA%'
               AND OWNER NOT IN ('SYS', 'SYSTEM', 'OUTLN', 'DBSNMP', 'APPQOSSYS', 'WMSYS', 'OJSYS', 'ORDDATA', 'ORDSYS', 'MDSYS', 'CTXSYS', 'XDB', 'ANONYMOUS', 'APEX_040200')
               AND TABLE_NAME NOT LIKE 'BIN$%'
             ORDER BY TABLE_NAME, COLUMN_NAME`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        console.log(`Found ${result.rows.length} columns:`);
        console.table(result.rows.slice(0, 80));
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
