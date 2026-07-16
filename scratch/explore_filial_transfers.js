require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    try {
        // 1. CONDVENDA distribution in PCPEDC (last 180d) - identify transfer cond
        console.log('===== CONDVENDA em PCPEDC (180d) =====');
        const cv = await conn.execute(
            `SELECT CONDVENDA, COUNT(*) QTD FROM PCPEDC
             WHERE DATA >= SYSDATE-180 GROUP BY CONDVENDA ORDER BY QTD DESC`, [], opt);
        console.table(cv.rows);

        // 2. PCPEDC columns referencing filial/cliente filial/transfer
        console.log('\n===== COLUNAS PCPEDC (filial/transf/dest) =====');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
             WHERE TABLE_NAME='PCPEDC' AND OWNER='BRAGO'
               AND (UPPER(COLUMN_NAME) LIKE '%FILIAL%' OR UPPER(COLUMN_NAME) LIKE '%TRANSF%'
                 OR UPPER(COLUMN_NAME) LIKE '%DEST%' OR UPPER(COLUMN_NAME) LIKE '%TIPO%')
             ORDER BY COLUMN_ID`, [], opt);
        console.table(cols.rows);

        // 3. Does PCCLIENT have a CODFILIAL link (client that IS a filial)?
        console.log('\n===== COLUNAS PCCLIENT (filial) =====');
        const cc = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
             WHERE TABLE_NAME='PCCLIENT' AND OWNER='BRAGO'
               AND (UPPER(COLUMN_NAME) LIKE '%FILIAL%' OR UPPER(COLUMN_NAME) LIKE '%TIPO%')
             ORDER BY COLUMN_ID`, [], opt);
        console.table(cc.rows);

        // 4. PCNFSAID CONDVENDA distribution + columns for filial dest
        console.log('\n===== CONDVENDA em PCNFSAID (180d) =====');
        const nfcv = await conn.execute(
            `SELECT CONDVENDA, COUNT(*) QTD FROM PCNFSAID
             WHERE DTSAIDA >= SYSDATE-180 GROUP BY CONDVENDA ORDER BY QTD DESC`, [], opt);
        console.table(nfcv.rows);

        // 5. PCNFSAID columns filial/dest
        console.log('\n===== COLUNAS PCNFSAID (filial/dest/transf) =====');
        const nfcols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
             WHERE TABLE_NAME='PCNFSAID' AND OWNER='BRAGO'
               AND (UPPER(COLUMN_NAME) LIKE '%FILIAL%' OR UPPER(COLUMN_NAME) LIKE '%TRANSF%'
                 OR UPPER(COLUMN_NAME) LIKE '%DEST%')
             ORDER BY COLUMN_ID`, [], opt);
        console.table(nfcols.rows);

        // 6. Filiais cadastradas e seus clientes vinculados (PCFILIAL)
        console.log('\n===== PCFILIAL (codigo / codcli) =====');
        try {
            const fil = await conn.execute(
                `SELECT CODIGO, NOME, CODCLI FROM PCFILIAL ORDER BY CODIGO`, [], opt);
            console.table(fil.rows);
        } catch(e){ console.log('PCFILIAL erro:', e.message); }

    } catch (err) {
        console.error('ERRO:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
