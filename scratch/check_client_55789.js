require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');

async function checkClient() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // 1. Verificar dados cadastrais
        const clientRes = await connection.execute(
            `SELECT CODCLI, CLIENTE, DTCADASTRO, CODUSUR1 
             FROM PCCLIENT 
             WHERE CODCLI = 55789`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('=== PCCLIENT (Dados Cadastrais) ===');
        console.log(JSON.stringify(clientRes.rows, null, 2));

        // 2. Verificar pedidos em PCPEDC (Pedidos de Venda)
        const pedRes = await connection.execute(
            `SELECT NUMPED, DATA, VLTOTAL, POSICAO
             FROM PCPEDC
             WHERE CODCLI = 55789
             ORDER BY DATA DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== PCPEDC (Pedidos de Venda) ===');
        console.log(JSON.stringify(pedRes.rows, null, 2));

        // 3. Verificar compras no faturamento (PCNFSAID)
        const salesResAll = await connection.execute(
            `SELECT NUMNOTA, DTSAIDA, VLTOTAL, CONDVENDA, DTCANCEL
             FROM PCNFSAID
             WHERE CODCLI = 55789
             ORDER BY DTSAIDA DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log('\n=== PCNFSAID (Faturamento) ===');
        console.log(JSON.stringify(salesResAll.rows, null, 2));

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

checkClient();
