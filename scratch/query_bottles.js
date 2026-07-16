require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        const query = await conn.execute(
            `SELECT CODPROD, DESCRICAO, CODEPTO
             FROM PCPRODUT
             WHERE DESCRICAO LIKE '%GARRAFA TRANSP%'
             OR CODPROD IN (15986, 15988, 15775)
             FETCH FIRST 20 ROWS ONLY`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(query.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
