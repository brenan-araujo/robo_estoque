require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== DADOS DA TABELA PCFILIAL ===');
        const res = await conn.execute(
            `SELECT CODIGO, FANTASIA, RAZAOSOCIAL, CODCLI, CODFORNEC, CODFILIALENTRADA FROM PCFILIAL ORDER BY CODIGO`,
            [], opt
        );
        console.table(res.rows);
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
