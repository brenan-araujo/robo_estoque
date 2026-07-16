require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        const tablesToCheck = [
            'PCESTTRANSITO',
            'PCTRANSFDEP',
            'PCTRANSFPRODUTO',
            'PCORDEMTRANSI',
            'PCORDEMTRANSC',
            'PCHISTESTTRANSITO'
        ];

        for (const tbl of tablesToCheck) {
            console.log(`\n===== COLUNAS DE ${tbl} =====`);
            try {
                const cols = await conn.execute(
                    `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH
                     FROM ALL_TAB_COLUMNS 
                     WHERE TABLE_NAME = :tbl AND OWNER = 'BRAGO'
                     ORDER BY COLUMN_ID`,
                    { tbl }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                if (cols.rows.length === 0) {
                    console.log('  Sem colunas ou tabela não encontrada');
                } else {
                    console.table(cols.rows);
                }
            } catch (e) {
                console.log(`  Erro: ${e.message}`);
            }
        }

        // Contar registros em cada tabela
        console.log('\n===== CONTAGEM DE REGISTROS =====');
        for (const tbl of tablesToCheck) {
            try {
                const cnt = await conn.execute(
                    `SELECT COUNT(*) AS TOTAL FROM ${tbl}`,
                    [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                console.log(`${tbl}: ${cnt.rows[0].TOTAL} registros`);
            } catch (e) {
                console.log(`${tbl}: Erro - ${e.message}`);
            }
        }

        // Amostra de PCESTTRANSITO
        console.log('\n===== AMOSTRA PCESTTRANSITO (10 linhas recentes) =====');
        try {
            const sample = await conn.execute(
                `SELECT * FROM PCESTTRANSITO WHERE ROWNUM <= 10`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            if (sample.rows.length > 0) {
                console.table(sample.rows);
            } else {
                console.log('Tabela vazia');
            }
        } catch (e) {
            console.log(`Erro: ${e.message}`);
        }

        // Amostra de PCTRANSFDEP
        console.log('\n===== AMOSTRA PCTRANSFDEP (10 linhas recentes) =====');
        try {
            const sample2 = await conn.execute(
                `SELECT * FROM PCTRANSFDEP WHERE ROWNUM <= 10`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );
            if (sample2.rows.length > 0) {
                console.table(sample2.rows);
            } else {
                console.log('Tabela vazia');
            }
        } catch (e) {
            console.log(`Erro: ${e.message}`);
        }

    } catch (err) {
        console.error('Erro geral:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
