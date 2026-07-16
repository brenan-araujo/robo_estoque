require('dotenv').config();
const oracledb = require('oracledb');
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing the SQL cuts/shortages query...');
        const query = `
            SELECT * FROM (
                SELECT 
                    C.DATA AS DATA_CORTE,
                    C.CODFILIAL AS FILIAL,
                    C.NUMPED AS NUMERO_PEDIDO,
                    C.CODCLI AS COD_CLIENTE,
                    CLI.CLIENTE AS NOME_CLIENTE,
                    C.CODUSUR AS COD_RCA,
                    U.NOME AS NOME_RCA,
                    C.CODPROD AS COD_PRODUTO,
                    P.DESCRICAO AS DESCRICAO_PRODUTO,
                    C.QTORIG AS QTD_ORIGINAL,
                    C.QTFALTA AS QTD_FALTA,
                    C.PVENDA AS PRECO_VENDA,
                    (C.QTFALTA * C.PVENDA) AS VALOR_FALTA,
                    C.MOTIVO AS MOTIVO_CORTE
                FROM BRAGO.PCCORTEI C
                LEFT JOIN BRAGO.PCPRODUT P ON C.CODPROD = P.CODPROD
                LEFT JOIN BRAGO.PCCLIENT CLI ON C.CODCLI = CLI.CODCLI
                LEFT JOIN BRAGO.PCUSUARI U ON C.CODUSUR = U.CODUSUR
                ORDER BY C.DATA DESC, C.NUMPED DESC
            ) WHERE ROWNUM <= 10
        `;
        
        const result = await conn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`Successfully fetched ${result.rows.length} rows:`);
        console.table(result.rows);
        
        await conn.close();
    } catch (err) {
        console.error('Error executing query:', err);
    } finally {
        await database.close();
    }
}

run();
