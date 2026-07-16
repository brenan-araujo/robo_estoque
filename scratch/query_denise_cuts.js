require('dotenv').config();
const db = require('../src/config/database');

async function getDeniseCuts() {
    let connection;
    try {
        await db.initialize();
        connection = await db.getConnection();
        
        // Query pending cuts for RCA 27 (Denise Braga) in the last 10 days
        const sql = `
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
                f.qt                             AS qt_falta,
                f.pvenda,
                (SELECT NVL(SUM(NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0) - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)), 0) 
                 FROM PCEST E 
                 WHERE E.CODPROD = f.codprod AND E.CODFILIAL = f.codfilial) AS qt_est_disponivel
            FROM pcfalta f
            INNER JOIN pcprodut p  ON p.codprod    = f.codprod
            INNER JOIN pcclient c  ON c.codcli     = f.codcli
            LEFT  JOIN pcusuari u  ON u.codusur    = f.codusur
            LEFT  JOIN pcpedc   ped ON ped.numped  = f.numped
            WHERE f.codusur = 27
              AND f.data >= TRUNC(SYSDATE) - 10
            ORDER BY f.data ASC, f.numped ASC
        `;

        const result = await connection.execute(
            sql,
            [],
            { outFormat: db.oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`Encontrados ${result.rows.length} registros de cortes para Denise (RCA 27):`);
        console.log(JSON.stringify(result.rows, null, 2));

    } catch (err) {
        console.error('Erro ao buscar cortes:', err);
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) {}
        }
        try { await db.close(); } catch (e) {}
    }
}

getDeniseCuts();
