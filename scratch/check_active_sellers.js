require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');

async function checkSellers() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // 1. Vendedores com meta no mês atual (Maio 2026)
        const activeRes = await connection.execute(
            `SELECT DISTINCT
                U.CODUSUR,
                U.NOME AS NOME_VENDEDOR,
                U.CODFILIAL,
                U.TELEFONE1,
                U.TELEFONE2,
                U.PSA_TELWHATS
             FROM PCUSUARI U
             JOIN PCMETA M ON M.CODUSUR = U.CODUSUR
             WHERE U.BLOQUEIO = 'N'
             AND M.DATA >= TO_DATE('2026-05-01', 'YYYY-MM-DD')
             AND M.DATA < TO_DATE('2026-06-01', 'YYYY-MM-DD')
             ORDER BY U.CODFILIAL, U.CODUSUR`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`=== Vendedores com meta no mês (Total: ${activeRes.rows.length}) ===`);
        activeRes.rows.forEach(r => {
            console.log(`${r.CODUSUR} - ${r.NOME_VENDEDOR} - Filial ${r.CODFILIAL}`);
        });

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

checkSellers();
