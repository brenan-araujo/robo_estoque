require('dotenv').config();
const database = require('./config/database');
const { oracledb } = require('./config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();

    try {
        console.log('=== VERIFICANDO ENTRADAS DO PRODUTO 18039 HOJE ===');
        const query = await conn.execute(
            `SELECT 
                M.NUMTRANSENT,
                M.CODPROD,
                M.QT,
                M.NUMNOTA,
                M.DTMOV,
                M.CODOPER,
                M.CODFILIAL
             FROM PCMOV M
             WHERE M.CODPROD = 18039
             AND M.CODFILIAL = '21'
             AND M.CODOPER IN ('E', 'EA', 'EB')
             AND M.DTMOV >= TRUNC(SYSDATE)
             ORDER BY M.NUMTRANSENT ASC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        if (query.rows.length === 0) {
            console.log('Nenhuma entrada encontrada para hoje.');
        } else {
            console.table(query.rows);
        }

    } catch (err) {
        console.error('Erro na consulta:', err.message);
    } finally {
        await conn.close();
        await database.close();
        process.exit(0);
    }
}
main().catch(e => { console.error(e.message); process.exit(1); });
