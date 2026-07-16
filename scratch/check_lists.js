const oracledb = require('oracledb');
require('dotenv').config();

oracledb.initOracleClient({ libDir: 'C:\\Users\\usuario001\\Documents\\api_consulta_estoque\\oracle_client\\instantclient_23_4' });

async function checkLists() {
    let connection;
    try {
        connection = await oracledb.getConnection({
            user: 'COMODATO',
            password: 'C0M0D4T0',
            connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=10.2.4.2)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=BRAG6010)))'
        });
        console.log('✅ Connected!');

        const targetDate = '2026-05-28';

        // 1. Novos Clientes
        const novosResult = await connection.execute(
            `SELECT cl.CODCLI, cl.CLIENTE AS NOME_CLIENTE, cl.CODUSUR1 AS RCA, U.NOME AS NOME_RCA
             FROM PCCLIENT cl
             JOIN PCUSUARI U ON U.CODUSUR = cl.CODUSUR1
             WHERE cl.DTCADASTRO >= TO_DATE(:dt, 'YYYY-MM-DD')
             AND cl.DTCADASTRO < TO_DATE(:dt, 'YYYY-MM-DD') + 1
             AND U.BLOQUEIO = 'N'
             ORDER BY cl.CODCLI`,
            { dt: targetDate },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`\n=== NOVOS CLIENTES DE ${targetDate} (${novosResult.rows.length}) ===`);
        novosResult.rows.forEach(r => {
            console.log(`COD=${r.CODCLI} | NOME=${r.NOME_CLIENTE.substring(0, 30)} | RCA=${r.RCA} (${r.NOME_RCA.substring(0, 15)})`);
        });

        // 2. Reativados
        const reativadosResult = await connection.execute(
            `SELECT cl.CODCLI, cl.CLIENTE AS NOME_CLIENTE, F.CODUSUR AS RCA, U.NOME AS NOME_RCA,
                    NVL(SUM(F.VLTOTAL), 0) AS VALOR_COMPRA
             FROM PCNFSAID F
             JOIN PCCLIENT cl ON cl.CODCLI = F.CODCLI
             JOIN PCUSUARI U ON U.CODUSUR = F.CODUSUR
             WHERE F.DTSAIDA >= TO_DATE(:dt, 'YYYY-MM-DD')
             AND F.DTSAIDA < TO_DATE(:dt, 'YYYY-MM-DD') + 1
             AND F.DTCANCEL IS NULL
             AND F.CONDVENDA IN (1, 7, 9)
             AND U.BLOQUEIO = 'N'
             AND NOT EXISTS (
                 SELECT 1 FROM PCNFSAID F2
                 WHERE F2.CODCLI = F.CODCLI
                 AND F2.DTCANCEL IS NULL
                 AND F2.CONDVENDA IN (1, 7, 9)
                 AND F2.DTSAIDA BETWEEN TO_DATE(:dt, 'YYYY-MM-DD') - 180 AND TO_DATE(:dt, 'YYYY-MM-DD') - 1
             )
             AND cl.DTCADASTRO < TO_DATE(:dt, 'YYYY-MM-DD')
             GROUP BY cl.CODCLI, cl.CLIENTE, F.CODUSUR, U.NOME
             ORDER BY VALOR_COMPRA DESC`,
            { dt: targetDate },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`\n=== CLIENTES REATIVADOS DE ${targetDate} (${reativadosResult.rows.length}) ===`);
        reativadosResult.rows.forEach(r => {
            console.log(`COD=${r.CODCLI} | NOME=${r.NOME_CLIENTE.substring(0, 30)} | RCA=${r.RCA} (${r.NOME_RCA.substring(0, 15)}) | COMPRA=R$ ${r.VALOR_COMPRA.toFixed(2)}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        if (connection) await connection.close();
    }
}

checkLists();
