require('dotenv').config();
const database = require('../src/config/database');

async function run() {
    try {
        await database.initialize();
        const conn = await database.getConnection();
        
        console.log('Testing PCPEDI lookup for 5 different products...');
        const products = [13290, 18480, 16992, 18481, 12711];
        
        for (const codprod of products) {
            console.time(`Lookup for CODPROD ${codprod}`);
            const result = await conn.execute(
                `SELECT COUNT(*) AS CNT 
                 FROM BRAGO.PCPEDI 
                 WHERE CODPROD = :codprod AND POSICAO IN ('P', 'B')`,
                { codprod }
            );
            console.timeEnd(`Lookup for CODPROD ${codprod}`);
            console.log(`Result: ${result.rows[0][0]}`);
        }
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await database.close();
    }
}

run();
