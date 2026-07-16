require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

const codes = [3, 4, 14566, 14631, 14574, 14573];

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- BUSCANDO POR FORNECEDORES (PCFORNEC) ---');
        const queryForn = await conn.execute(
            `SELECT CODFORNEC, FORNECEDOR, FANTASIA
             FROM PCFORNEC
             WHERE CODFORNEC IN (${codes.join(', ')})`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(queryForn.rows);

        console.log('--- BUSCANDO POR DEPARTAMENTOS (PCDEPTO) ---');
        const queryDepto = await conn.execute(
            `SELECT CODEPTO, DESCRICAO
             FROM PCDEPTO
             WHERE CODEPTO IN (${codes.join(', ')})`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(queryDepto.rows);

        console.log('--- BUSCANDO POR PRODUTOS (PCPRODUT) ---');
        const queryProd = await conn.execute(
            `SELECT CODPROD, DESCRICAO, CODEPTO, CODFORNEC
             FROM PCPRODUT
             WHERE CODPROD IN (${codes.join(', ')})`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(queryProd.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
