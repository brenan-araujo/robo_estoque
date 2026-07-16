require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    try {
        // PCFILIAL columns
        console.log('===== COLUNAS PCFILIAL =====');
        const fc = await conn.execute(
            `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME='PCFILIAL' AND OWNER='BRAGO'
              AND (UPPER(COLUMN_NAME) LIKE '%COD%' OR UPPER(COLUMN_NAME) LIKE '%CLI%' OR UPPER(COLUMN_NAME) LIKE '%UF%' OR UPPER(COLUMN_NAME) LIKE '%FANT%' OR UPPER(COLUMN_NAME) LIKE '%RAZAO%')
             ORDER BY COLUMN_ID`, [], opt);
        console.log(fc.rows.map(r=>r.COLUMN_NAME).join(', '));

        // Sample CONDVENDA=5 PCNFSAID transfer NFs - origin/dest/dates
        console.log('\n===== AMOSTRA PCNFSAID CONDVENDA=5 (transferências) =====');
        const s = await conn.execute(
            `SELECT CODFILIAL, CODFILIALNF, CODCLI, CODCLIFILIAL, TRANSFDEP,
                    NUMNOTA, DTSAIDA, DTFAT, NUMTRANSVENDA, NUMTRANSVENDADESTINO, NUMTRANSENTDEST
             FROM PCNFSAID WHERE CONDVENDA=5 AND DTSAIDA >= SYSDATE-180
             ORDER BY DTSAIDA DESC FETCH FIRST 15 ROWS ONLY`, [], opt);
        console.table(s.rows);

        // PCPEDC CONDVENDA=5 - dates pedido/fat + filial origem + cliente
        console.log('\n===== AMOSTRA PCPEDC CONDVENDA=5 =====');
        const p = await conn.execute(
            `SELECT NUMPED, CODFILIAL, CODFILIALNF, CODCLI, POSICAO, DATA AS DT_PEDIDO,
                    DTFAT, DTNFTRANSF, NUMNFTRANSF, NUMTRANSVENDA, NUMTRANSACAOTRANSF, NUMNOTA
             FROM PCPEDC WHERE CONDVENDA=5 AND DATA >= SYSDATE-180
             ORDER BY DATA DESC FETCH FIRST 15 ROWS ONLY`, [], opt);
        console.table(p.rows);

        // Map: distinct origin->dest for CONDVENDA=5 transfers (using CODCLIFILIAL to find dest filial)
        console.log('\n===== CONDVENDA=5: CODFILIAL origem x CODCLIFILIAL (cliente=filial destino) =====');
        const map = await conn.execute(
            `SELECT CODFILIAL, CODCLIFILIAL, COUNT(*) QTD, MIN(DTSAIDA) DESDE, MAX(DTSAIDA) ATE
             FROM PCNFSAID WHERE CONDVENDA=5 AND DTSAIDA >= SYSDATE-180
             GROUP BY CODFILIAL, CODCLIFILIAL ORDER BY QTD DESC`, [], opt);
        console.table(map.rows);

        // Which CODCLI correspond to filiais? check PCCLIENT.CODFILIALNF or name
        console.log('\n===== CLIENTES usados nessas transferências (CONDVENDA=5) =====');
        const cli = await conn.execute(
            `SELECT DISTINCT N.CODCLI, C.CLIENTE, C.CODCIDADE, C.ESTADO, C.CODFILIALNF
             FROM PCNFSAID N JOIN PCCLIENT C ON C.CODCLI=N.CODCLI
             WHERE N.CONDVENDA=5 AND N.DTSAIDA >= SYSDATE-180
             ORDER BY N.CODCLI`, [], opt);
        console.table(cli.rows);

    } catch (err) {
        console.error('ERRO:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}
main();
