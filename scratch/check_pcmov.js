const oracledb = require('oracledb');
require('dotenv').config();

oracledb.initOracleClient({ libDir: 'C:\\Users\\usuario001\\Documents\\api_consulta_estoque\\oracle_client\\instantclient_23_4' });

async function checkPcmov() {
    let connection;
    try {
        connection = await oracledb.getConnection({
            user: 'COMODATO',
            password: 'C0M0D4T0',
            connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=10.2.4.2)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=BRAG6010)))'
        });
        console.log('✅ Connected!');

        const result = await connection.execute(
            `SELECT CODPROD, NUMTRANSENT, NUMBONUS, DTMOV, CODOPER, CODFILIAL, QT 
             FROM PCMOV 
             WHERE DTMOV >= TRUNC(SYSDATE)
             AND CODOPER IN ('E', 'EB')
             AND QT > 0`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`Total PCMOV entries today: ${result.rows.length}`);
        result.rows.forEach((row, i) => {
            console.log(`PCMOV ${i+1}: CODPROD=${row.CODPROD}, QT=${row.QT}, NUMTRANSENT=${row.NUMTRANSENT}, NUMBONUS=${row.NUMBONUS}, OPER=${row.CODOPER}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        if (connection) await connection.close();
    }
}

checkPcmov();
