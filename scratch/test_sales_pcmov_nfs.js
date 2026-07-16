require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');

async function test() {
    try {
        await initialize();
        const conn = await getConnection();
        
        console.log("=== COUNT OF MOVEMENT SALES BETWEEN 01/06/2026 AND 30/08/2026 ===");
        const r1 = await conn.execute(`
            SELECT COUNT(*) AS QTD
            FROM PCMOV m
            JOIN PCNFSAID f ON m.NUMTRANSVENDA = f.NUMTRANSVENDA
            JOIN PCPRODUT p ON p.CODPROD = m.CODPROD
            WHERE p.CODFORNEC = 15500
            AND m.CODOPER = 'S'
            AND f.DTCANCEL IS NULL
            AND f.CONDVENDA IN (1, 7, 9)
            AND f.DTSAIDA BETWEEN TO_DATE('01/06/2026', 'DD/MM/YYYY') AND TO_DATE('30/08/2026', 'DD/MM/YYYY')
        `);
        console.log("Total sales in range:", r1.rows);
        
        if (r1.rows[0][0] > 0) {
            console.log("Sample sales records in range:");
            const r2 = await conn.execute(`
                SELECT f.CODFILIAL, f.CODUSUR, f.CODCLI, f.DTSAIDA, m.CODPROD, m.QT, m.PUNIT
                FROM PCMOV m
                JOIN PCNFSAID f ON m.NUMTRANSVENDA = f.NUMTRANSVENDA
                JOIN PCPRODUT p ON p.CODPROD = m.CODPROD
                WHERE p.CODFORNEC = 15500
                AND m.CODOPER = 'S'
                AND f.DTCANCEL IS NULL
                AND f.CONDVENDA IN (1, 7, 9)
                AND f.DTSAIDA BETWEEN TO_DATE('01/06/2026', 'DD/MM/YYYY') AND TO_DATE('30/08/2026', 'DD/MM/YYYY')
                AND ROWNUM <= 10
            `);
            console.log(r2.rows);
        }
        
        await conn.close();
        await close();
    } catch(err) {
        console.error(err);
    }
}
test();
