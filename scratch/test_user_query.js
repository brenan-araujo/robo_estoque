require('dotenv').config();
const { oracledb } = require('../src/config/database');
const database = require('../src/config/database');

async function main() {
    await database.initialize();
    const conn = await database.getConnection();

    // Calculamos datas para os últimos 7 dias
    const today = new Date();
    const pastSevenDays = new Date();
    pastSevenDays.setDate(today.getDate() - 7);

    // Formato DD/MM/YYYY
    const formatDate = (date) => {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    };

    const dataIni = formatDate(pastSevenDays);
    const dataFim = formatDate(today);

    console.log(`Buscando dados entre ${dataIni} e ${dataFim}...`);

    try {
        const sql = `
            SELECT * FROM (
                SELECT
                    f.data,
                    f.numped,
                    f.codfilial,
                    f.codusur                        AS rca,
                    u.nome                           AS nome_rca,
                    f.codcli,
                    c.cliente,
                    f.codprod,
                    p.descricao,
                    fo.codfornec,
                    fo.fornecedor,
                    f.qt                             AS qt_falta,
                    f.pvenda,
                    NVL(f.qt * f.pvenda, 0)          AS valor_total,
                    (
                        SELECT NVL(SUM(qtestger),0) - NVL(SUM(qtreserv),0)
                                - NVL(SUM(qtindeniz),0) - NVL(SUM(qtbloqueada),0)
                        FROM   pcest
                        WHERE  codprod   = f.codprod
                          AND  codfilial = NVL(:FILIAL, codfilial)
                    )                                AS estoque_atual,
                    p.obs2                           AS fora_linha,
                    CASE NVL(ped.posicao, 'S')
                        WHEN 'L' THEN 'LIBERADO'
                        WHEN 'P' THEN 'PENDENTE'
                        WHEN 'B' THEN 'BLOQUEADO'
                        WHEN 'S' THEN 'CANCELADO'
                        ELSE 'CANCELADO'
                    END AS status_pedido,
                    (
                        SELECT MAX(motivo)
                        FROM   pcnfcanitem
                        WHERE  numped = f.numped
                    )                                AS motivo_cancelamento
                FROM pcfalta f
                INNER JOIN pcprodut p  ON p.codprod    = f.codprod
                INNER JOIN pcclient c  ON c.codcli     = f.codcli
                INNER JOIN pcfornec fo ON fo.codfornec = p.codfornec
                LEFT  JOIN pcusuari u  ON u.codusur    = f.codusur
                LEFT  JOIN pcpedc   ped ON ped.numped  = f.numped
                WHERE f.data BETWEEN TO_DATE(:DATA_INI,'dd/mm/yyyy')
                                 AND TO_DATE(:DATA_FIM,'dd/mm/yyyy')
                  AND f.codfilial = NVL(:FILIAL, f.codfilial)
                ORDER BY f.data, f.codprod
            ) WHERE ROWNUM <= 5
        `;

        const binds = {
            FILIAL: null,
            DATA_INI: dataIni,
            DATA_FIM: dataFim
        };

        const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log('\n✅ Consulta executada com sucesso!');
        console.log(`Retornados ${result.rows.length} registros para preview:\n`);
        console.table(result.rows);

    } catch (err) {
        console.error('❌ Erro ao executar a consulta:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}

main();
