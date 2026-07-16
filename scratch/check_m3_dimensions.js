require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- SAMPLE OF M3 DIMENSION VALUES ---');
        // Let's sample some products that have these populated
        const sample = await conn.execute(
            `SELECT * FROM (
                SELECT CODPROD, DESCRICAO, QTUNITCX, ALTURAM3, LARGURAM3, COMPRIMENTOM3, VOLUME, PESOBRUTO
                FROM BRAGO.PCPRODUT 
                WHERE ALTURAM3 > 0 OR LARGURAM3 > 0
            ) WHERE ROWNUM <= 20`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(sample.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
