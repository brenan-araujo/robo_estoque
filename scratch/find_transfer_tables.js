require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        console.log('--- 1. BUSCANDO TABELAS RELACIONADAS A TRANSFERÊNCIAS ---');
        const tables = await conn.execute(
            `SELECT OWNER, TABLE_NAME 
             FROM ALL_TABLES 
             WHERE OWNER = 'BRAGO'
               AND (
                 TABLE_NAME LIKE '%TRANS%'
                 OR TABLE_NAME LIKE '%TRANSF%'
                 OR TABLE_NAME LIKE '%FILIAL%'
                 OR TABLE_NAME LIKE '%REPASS%'
               )
             ORDER BY TABLE_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(`Encontradas ${tables.rows.length} tabelas:`);
        console.table(tables.rows);

        // Verificar se PCPEDIDO tem tipo de pedido para transferência
        console.log('\n--- 2. TIPOS DE PEDIDO em PCPEDIDO (TIPOPED/POSICAO) ---');
        const tiposPed = await conn.execute(
            `SELECT TIPOPED, COUNT(*) AS QTD
             FROM PCPEDIDO
             WHERE ROWNUM <= 100000
             GROUP BY TIPOPED
             ORDER BY QTD DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(tiposPed.rows);

        // Verificar colunas de PCPEDIDO relacionadas a filial destino
        console.log('\n--- 3. COLUNAS DE PCPEDIDO (buscar FILIAL, DESTINO, TRANSF) ---');
        const colsPed = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCPEDIDO' AND OWNER = 'BRAGO'
               AND (
                 UPPER(COLUMN_NAME) LIKE '%FILIAL%'
                 OR UPPER(COLUMN_NAME) LIKE '%TRANSF%'
                 OR UPPER(COLUMN_NAME) LIKE '%DEST%'
                 OR UPPER(COLUMN_NAME) LIKE '%ORIGEM%'
                 OR UPPER(COLUMN_NAME) LIKE '%TIPO%'
               )
             ORDER BY COLUMN_ID`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(colsPed.rows);

        // Verificar se existe tabela PCPEDTRANSF ou similar
        console.log('\n--- 4. TABELAS COM "PC" E "TRA" NO NOME ---');
        const pcTables = await conn.execute(
            `SELECT TABLE_NAME 
             FROM ALL_TABLES 
             WHERE OWNER = 'BRAGO'
               AND TABLE_NAME LIKE 'PC%'
               AND (TABLE_NAME LIKE '%TRA%' OR TABLE_NAME LIKE '%MOV%')
             ORDER BY TABLE_NAME`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pcTables.rows);

        // Verificar colunas de PCMOV relacionadas a transferência
        console.log('\n--- 5. OPERAÇÕES (CODOPER) EM PCMOV ---');
        const codoper = await conn.execute(
            `SELECT CODOPER, COUNT(*) AS QTD
             FROM PCMOV
             WHERE ROWNUM <= 500000
             GROUP BY CODOPER
             ORDER BY QTD DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(codoper.rows);

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
