require('dotenv').config();
const { initialize, getConnection, close } = require('../src/config/database');

async function test() {
    try {
        await initialize();
        const conn = await getConnection();
        
        console.log("=== DISTINCT CODOPER IN PCMOV FOR SUPPLIER 15500 ===");
        const r1 = await conn.execute(`
            SELECT m.CODOPER, COUNT(*) AS QTD
            FROM PCMOV m
            JOIN PCPRODUT p ON p.CODPROD = m.CODPROD
            WHERE p.CODFORNEC = 15500
            GROUP BY m.CODOPER
        `);
        console.log(r1.rows);
        
        console.log("=== CANCELATION FIELDS OR CONDITIONS IN PCMOV ===");
        // Let's check some sample sales in PCMOV to see if there's any status or cancelation indicators
        const r2 = await conn.execute(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM ALL_TAB_COLUMNS 
            WHERE TABLE_NAME = 'PCMOV' AND OWNER = 'BRAGO'
            AND (COLUMN_NAME LIKE '%CANCEL%' OR COLUMN_NAME LIKE '%STATUS%' OR COLUMN_NAME LIKE '%OPER%')
        `);
        console.log(r2.rows);

        console.log("=== CHECK RELATION BETWEEN PCMOV AND PCNFSAID ===");
        // Let's check how we link PCMOV and PCNFSAID. Usually via NUMTRANSVENDA
        const r3 = await conn.execute(`
            SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS 
            WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCNFSAID'
            AND COLUMN_NAME IN ('NUMTRANSVENDA', 'NUMTRANS', 'NUMNOTA')
        `);
        console.log("PCNFSAID columns:", r3.rows);

        const r4 = await conn.execute(`
            SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS 
            WHERE OWNER = 'BRAGO' AND TABLE_NAME = 'PCMOV'
            AND COLUMN_NAME IN ('NUMTRANSVENDA', 'NUMTRANS', 'NUMNOTA')
        `);
        console.log("PCMOV columns:", r4.rows);
        
        await conn.close();
        await close();
    } catch(err) {
        console.error(err);
    }
}
test();
