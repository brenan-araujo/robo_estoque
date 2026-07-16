require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('=== Checking PCMOV for product 17321 ===');
        const r1 = await conn.execute(
            `SELECT NUMTRANSENT, NUMBONUS, CODPROD, CODFILIAL, QT, NUMNOTA, DTMOV, CODOPER, CODFORNEC
             FROM BRAGO.PCMOV
             WHERE CODPROD = 17321
               AND DTMOV >= TRUNC(SYSDATE) - 30
               AND CODOPER IN ('E', 'EB')`
        );
        console.table(r1.rows);

        console.log('\n=== Checking PCLOGDESBLOQUEIO for product 17321 ===');
        const r2 = await conn.execute(
            `SELECT NUMTRANSENT, NUMBONUS, CODPROD, QTDESBLOQUEADA, DTDESBLOQUEIO
             FROM BRAGO.PCLOGDESBLOQUEIO
             WHERE CODPROD = 17321
             ORDER BY DTDESBLOQUEIO DESC`
        );
        console.table(r2.rows);

        console.log('\n=== Checking PCEST for product 17321 ===');
        const r3 = await conn.execute(
            `SELECT CODFILIAL, QTESTGER, QTRESERV, QTBLOQUEADA 
             FROM BRAGO.PCEST
             WHERE CODPROD = 17321`
        );
        console.table(r3.rows);

        console.log('\n=== Checking PCPEDI for product 17321 ===');
        const r4 = await conn.execute(
            `SELECT NUMPED, CODFILIALRETIRA, POSICAO, QT, DATA
             FROM BRAGO.PCPEDI
             WHERE CODPROD = 17321
               AND POSICAO IN ('P', 'B')`
        );
        console.table(r4.rows);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
