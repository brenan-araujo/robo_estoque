require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Querying QTCORTADA vs QTFALTA...');
        const query = `
            SELECT * FROM (
                SELECT 
                    DATA, NUMPED, CODPROD, QTORIG, QTCORTADA, QTFALTA, PVENDA, MOTIVO, TIPOCORTE
                FROM BRAGO.PCCORTEI
                WHERE QTCORTADA > 0 OR QTFALTA > 0
                ORDER BY DATA DESC
            ) WHERE ROWNUM <= 10
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.table(result.rows);
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
