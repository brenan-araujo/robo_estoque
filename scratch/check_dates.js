require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');

async function test() {
    try {
        await initialize();
        const conn = await getConnection();
        
        console.log("1. Qtd produtos vinculados a CODFORNEC = 15500:");
        const r1 = await conn.execute(
            `SELECT COUNT(*) AS QTD FROM PCPRODUT WHERE CODFORNEC = 15500`
        );
        console.log(r1.rows);
        
        console.log("2. Produtos que contêm 'BOM PRIN' na descrição:");
        const r2 = await conn.execute(
            `SELECT CODPROD, DESCRICAO, CODFORNEC FROM PCPRODUT WHERE DESCRICAO LIKE '%BOM PRIN%'`
        );
        console.log(r2.rows);

        console.log("3. Fornecedores cadastrados com nome similar no PCFORNEC:");
        const r3 = await conn.execute(
            `SELECT CODFORNEC, FANTASIA FROM PCFORNEC WHERE FANTASIA LIKE '%PRIN%' OR FORNECEDOR LIKE '%PRIN%'`
        );
        console.log(r3.rows);

        console.log("4. Buscar vendas da Bom Princípio usando LIKE na descrição do produto:");
        const r4 = await conn.execute(
            `SELECT COUNT(*) AS QTD 
             FROM PCPEDC c
             JOIN PCITEM i ON i.NUMPED = c.numped
             JOIN PCPRODUT p ON p.codprod = i.codprod
             WHERE p.DESCRICAO LIKE '%BOM PRIN%'`
        );
        console.log(r4.rows);
        
        await conn.close();
        await close();
    } catch(err) {
        console.error(err);
    }
}
test();
