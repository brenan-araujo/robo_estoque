require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');

async function main() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // 1. Search for tables in ALL_TABLES matching Client or Address patterns in BRAGO schema
        const tablesRes = await connection.execute(
            `SELECT TABLE_NAME 
             FROM ALL_TABLES 
             WHERE OWNER = 'BRAGO' AND (TABLE_NAME LIKE 'PCCLIENT%' OR TABLE_NAME LIKE '%ENDERECO%')
             ORDER BY TABLE_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('=== Tables matching PCCLIENT or ENDERECO ===');
        console.log(JSON.stringify(tablesRes.rows, null, 2));

        // 2. Search for salesperson named Wilma
        try {
            const rcaRes = await connection.execute(
                `SELECT CODUSUR, NOME, BLOQUEIO 
                 FROM BRAGO.PCUSUARI 
                 WHERE NOME LIKE '%WILMA%'`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            console.log('\n=== Salespersons matching WILMA ===');
            console.log(JSON.stringify(rcaRes.rows, null, 2));
        } catch (e) {
            console.log('Error querying PCUSUARI:', e.message);
        }

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

main();
