require('dotenv').config();
const database = require('../src/config/database');
const logger = require('../src/utils/logger');

async function main() {
    logger.info('🔍 Verificando produto 17970 no banco de dados...');
    try {
        await database.initialize();
        const conn = await database.getConnection();

        // 1. Verificando PCEST
        logger.info('--- PCEST ---');
        const estResult = await conn.execute(
            `SELECT CODFILIAL, QTESTGER, QTRESERV, QTINDENIZ, QTBLOQUEADA,
                    (QTESTGER - QTRESERV - QTINDENIZ - QTBLOQUEADA) AS DISP
             FROM PCEST 
             WHERE CODPROD = 17970`,
            [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(estResult.rows.filter(r => r.QTESTGER > 0 || r.DISP !== 0));

        // 2. Verificando PCLOGDESBLOQUEIO hoje
        logger.info('--- PCLOGDESBLOQUEIO ---');
        const logResult = await conn.execute(
            `SELECT NUMTRANSENT, NUMBONUS, CODFILIAL, CODPROD, QTDESBLOQUEADA, DTDESBLOQUEIO
             FROM PCLOGDESBLOQUEIO 
             WHERE CODPROD = 17970
             ORDER BY DTDESBLOQUEIO DESC`,
            [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(logResult.rows.slice(0, 10));

        // 3. Verificando PCMOV recente
        logger.info('--- PCMOV ---');
        const movResult = await conn.execute(
            `SELECT NUMTRANSENT, NUMBONUS, CODPROD, CODFILIAL, QT, NUMNOTA, DTMOV, CODOPER, CODFORNEC
             FROM PCMOV 
             WHERE CODPROD = 17970 AND DTMOV >= TRUNC(SYSDATE) - 3
             ORDER BY DTMOV DESC`,
            [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(movResult.rows);

        // 4. Verificando PCPEDI pendências
        logger.info('--- PCPEDI ---');
        const pedResult = await conn.execute(
            `SELECT NUMPED, CODPROD, CODFILIAL, CODFILIALRETIRA, QT, POSICAO
             FROM PCPEDI 
             WHERE CODPROD = 17970 AND POSICAO IN ('P', 'B')`,
            [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(pedResult.rows);

        await conn.close();
    } catch (err) {
        logger.error(`Erro ao consultar dados: ${err.message}`);
        console.error(err);
    } finally {
        await database.close();
    }
}

main();
