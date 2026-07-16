const oracledb = require('oracledb');
require('dotenv').config();

oracledb.initOracleClient({ libDir: 'C:\\Users\\usuario001\\Documents\\api_consulta_estoque\\oracle_client\\instantclient_23_4' });

async function checkDates() {
    let connection;
    try {
        connection = await oracledb.getConnection({
            user: 'COMODATO',
            password: 'C0M0D4T0',
            connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=10.2.4.2)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=BRAG6010)))'
        });
        console.log('✅ Connected!');

        // Check movements for the transaction entries and bonuses that were unlocked today
        const result = await connection.execute(
            `SELECT CODPROD, NUMTRANSENT, NUMBONUS, DTMOV, CODOPER, QT 
             FROM PCMOV 
             WHERE NUMTRANSENT IN (373165, 373166) 
             OR NUMBONUS IN (17861, 17860)`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`Matching PCMOV rows: ${result.rows.length}`);
        result.rows.forEach((row, i) => {
            console.log(`PCMOV ${i+1}: CODPROD=${row.CODPROD}, QT=${row.QT}, NUMTRANSENT=${row.NUMTRANSENT}, NUMBONUS=${row.NUMBONUS}, DTMOV=${row.DTMOV}, OPER=${row.CODOPER}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        if (connection) await connection.close();
    }
}

checkDates();
