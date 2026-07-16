require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    try {
        // 1. Todas as colunas de PCTRANSFDEP
        console.log('===== TODAS AS COLUNAS DE PCTRANSFDEP =====');
        const cols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCTRANSFDEP' AND OWNER = 'BRAGO'
             ORDER BY COLUMN_ID`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(cols.rows);

        // 2. Transferências recentes (últimos 30 dias) com status
        console.log('\n===== TRANSFERÊNCIAS RECENTES (últimos 60 dias) =====');
        const recent = await conn.execute(
            `SELECT 
                T.NUMTRANSVENDA,
                T.NUMTRANSENT,
                T.CODFILIALORIGEM,
                T.CODFILIALDESTINO,
                T.CODPROD,
                P.DESCRICAO AS PRODUTO,
                T.QTTRANSF,
                T.DTTRANSF,
                T.DTMOVTRANSF,
                T.NUMTRANSTRANSFSAIDA,
                T.NUMTRANSTRANSFENT
             FROM PCTRANSFDEP T
             JOIN PCPRODUT P ON T.CODPROD = P.CODPROD
             WHERE T.DTTRANSF >= SYSDATE - 60
             ORDER BY T.DTTRANSF DESC
             FETCH FIRST 20 ROWS ONLY`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(`Encontradas ${recent.rows.length} transferências recentes`);
        if (recent.rows.length > 0) {
            console.table(recent.rows);
        }

        // 3. Verificar se PCPEDC (pedidos de venda) tem campo para identificar se é transferência
        console.log('\n===== VERIFICAR PCPEDC TIPOPEDIDO E CODFILIALDESTINO =====');
        const pecols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCPEDC' AND OWNER = 'BRAGO'
               AND (
                 UPPER(COLUMN_NAME) LIKE '%FILIAL%'
                 OR UPPER(COLUMN_NAME) LIKE '%TIPO%'
                 OR UPPER(COLUMN_NAME) LIKE '%TRANSF%'
                 OR UPPER(COLUMN_NAME) LIKE '%DEST%'
                 OR UPPER(COLUMN_NAME) LIKE '%STATUS%'
                 OR UPPER(COLUMN_NAME) LIKE '%POSICAO%'
               )
             ORDER BY COLUMN_ID`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pecols.rows);

        // 4. Verificar PCPEDIDO (pedidos de compra) se tem campo de transferência
        console.log('\n===== COLUNAS DE PCPEDIDO RELACIONADAS A TRANSF =====');
        const pedcols = await conn.execute(
            `SELECT COLUMN_NAME, DATA_TYPE 
             FROM ALL_TAB_COLUMNS 
             WHERE TABLE_NAME = 'PCPEDIDO' AND OWNER = 'BRAGO'
               AND (
                 UPPER(COLUMN_NAME) LIKE '%FILIAL%'
                 OR UPPER(COLUMN_NAME) LIKE '%TIPO%'
                 OR UPPER(COLUMN_NAME) LIKE '%TRANSF%'
                 OR UPPER(COLUMN_NAME) LIKE '%DEST%'
               )
             ORDER BY COLUMN_ID`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(pedcols.rows);

        // 5. Verificar se há um status de "em trânsito" na PCTRANSFDEP
        // Verificar se DTMOVTRANSF nulo significa pendente
        console.log('\n===== ESTATÍSTICA PCTRANSFDEP: DTMOVTRANSF NULL (em trânsito?) =====');
        const nullStats = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL,
                SUM(CASE WHEN DTMOVTRANSF IS NULL THEN 1 ELSE 0 END) AS SEM_DT_RECEBIMENTO,
                SUM(CASE WHEN DTMOVTRANSF IS NOT NULL THEN 1 ELSE 0 END) AS COM_DT_RECEBIMENTO,
                MAX(DTTRANSF) AS ULTIMA_TRANSF,
                MAX(DTMOVTRANSF) AS ULTIMO_RECEBIMENTO
             FROM PCTRANSFDEP`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(nullStats.rows);

        // 6. Transferências pendentes de recebimento
        console.log('\n===== TRANSFERÊNCIAS PENDENTES (sem data de recebimento) =====');
        const pending = await conn.execute(
            `SELECT 
                T.NUMTRANSVENDA,
                T.CODFILIALORIGEM,
                T.CODFILIALDESTINO,
                T.CODPROD,
                P.DESCRICAO AS PRODUTO,
                T.QTTRANSF,
                T.DTTRANSF
             FROM PCTRANSFDEP T
             JOIN PCPRODUT P ON T.CODPROD = P.CODPROD
             WHERE T.DTMOVTRANSF IS NULL
               AND T.DTTRANSF >= SYSDATE - 90
             ORDER BY T.DTTRANSF DESC
             FETCH FIRST 15 ROWS ONLY`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.log(`Encontradas ${pending.rows.length} pendentes`);
        if (pending.rows.length > 0) {
            console.table(pending.rows);
        }

        // 7. Verificar se PCNFSAID tem tipo de NF para transferência (TIPONF / NATOPER)
        console.log('\n===== TIPOS DE NF EM PCNFSAID (procurar transferência) =====');
        const nfTypes = await conn.execute(
            `SELECT TIPONOTA, COUNT(*) AS QTD
             FROM PCNFSAID
             WHERE ROWNUM <= 1000000
             GROUP BY TIPONOTA
             ORDER BY QTD DESC
             FETCH FIRST 10 ROWS ONLY`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        console.table(nfTypes.rows);

    } catch (err) {
        console.error('Erro geral:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
