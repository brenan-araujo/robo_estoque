require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('=== ANALISANDO COMBINAÇÕES DE FILIAIS EM PCTRANSFDEP (DTMOVTRANSF IS NULL) ===');
        const res = await conn.execute(
            `SELECT CODFILIALORIGEM, CODFILIALDESTINO, COUNT(*) as QTD, MIN(DTTRANSF) as DATA_MINIMA, MAX(DTTRANSF) as DATA_MAXIMA
             FROM PCTRANSFDEP
             WHERE DTMOVTRANSF IS NULL
             GROUP BY CODFILIALORIGEM, CODFILIALDESTINO
             ORDER BY QTD DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
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
