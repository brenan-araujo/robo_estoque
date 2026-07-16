require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('--- Checking intermediate counts ---');
        
        // 1. Total PCMOV rows in last 30 days with CODOPER IN ('E', 'EB')
        const r1 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCMOV M
             JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
             WHERE M.DTMOV >= TRUNC(SYSDATE) - 30
             AND M.CODOPER IN ('E', 'EB')
             AND M.QT > 0`
        );
        console.log(`1. PCMOV rows (E/EB, last 30d): ${r1.rows[0][0]}`);

        // 2. How many of those have COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) IS NULL
        const r2 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCMOV M
             JOIN BRAGO.PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
             LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DE ON DE.CODPROD = M.CODPROD AND DE.NUMTRANSENT = M.NUMTRANSENT
             LEFT JOIN BRAGO.PCLOGDESBLOQUEIO DEB ON DEB.CODPROD = M.CODPROD AND M.NUMBONUS > 0 AND DEB.NUMBONUS = M.NUMBONUS
             WHERE M.DTMOV >= TRUNC(SYSDATE) - 30
             AND M.CODOPER IN ('E', 'EB')
             AND M.QT > 0
             AND COALESCE(DE.DTDESBLOQUEIO, DEB.DTDESBLOQUEIO) IS NULL`
        );
        console.log(`2. ... and are not unlocked yet (COALESCE IS NULL): ${r2.rows[0][0]}`);

        // 3. How many rows in PCLOGDESBLOQUEIO for today
        const r3 = await conn.execute(
            `SELECT COUNT(*) FROM BRAGO.PCLOGDESBLOQUEIO WHERE DTDESBLOQUEIO >= TRUNC(SYSDATE)`
        );
        console.log(`3. PCLOGDESBLOQUEIO rows (today): ${r3.rows[0][0]}`);

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
