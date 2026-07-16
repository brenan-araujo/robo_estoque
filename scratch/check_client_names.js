require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        console.log('=== CONSULTANDO CLIENTES NO WINTHOR ===');
        const query = `
        SELECT CODCLI, CLIENTE, FANTASIA
        FROM PCCLIENT
        WHERE CODCLI IN (35862, 31382, 37166, 38946, 41806, 3350, 35273, 30905, 54825, 44487, 44775, 44577, 44575, 31992)
        `;
        const res = await conn.execute(query, [], opt);
        console.table(res.rows);
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
