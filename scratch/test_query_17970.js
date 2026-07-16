require('dotenv').config();
const database = require('../src/config/database');
const logger = require('../src/utils/logger');

async function main() {
    logger.info('🏁 Testando a query de getNewEntries para o produto 17970...');
    try {
        await database.initialize();
        const conn = await database.getConnection();

        // Data de ontem às 00:00 para pegar o desbloqueio de hoje
        const lastUnlockDate = new Date();
        lastUnlockDate.setDate(lastUnlockDate.getDate() - 1);
        lastUnlockDate.setHours(0, 0, 0, 0);

        logger.info(`Filtro lastUnlockDate: ${lastUnlockDate.toISOString()}`);

        const query = `
        SELECT 
            M.NUMTRANSENT,
            M.CODPROD,
            P.DESCRICAO,
            M.CODFILIAL,
            M.QT,
            M.NUMNOTA,
            M.CODOPER,
            DE.DTDESBLOQUEIO,
            -- Subquery 1: estoque disponível
            (SELECT NVL(SUM(
                NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
             ), 0)
             FROM PCEST E
             WHERE E.CODPROD = M.CODPROD
             AND (
                 (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                 OR
                 (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
             )
            ) AS QTDISP,
            -- Regra de estoque > 0
            CASE WHEN (SELECT NVL(SUM(
                NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0)
                - NVL(E.QTINDENIZ,0) - NVL(E.QTBLOQUEADA,0)
             ), 0)
             FROM PCEST E
             WHERE E.CODPROD = M.CODPROD
             AND (
                 (M.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                 OR
                 (M.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = M.CODFILIAL)
             )
            ) > 0 THEN 'SIM' ELSE 'NAO' END AS ESTOQUE_MAIOR_QUE_ZERO
         FROM PCMOV M
         JOIN PCPRODUT P ON P.CODPROD = M.CODPROD AND P.REVENDA = 'S' AND P.CODEPTO <> 6
         LEFT JOIN PCFILIAL F ON F.CODIGO = M.CODFILIAL
         LEFT JOIN PCFORNEC FORN ON FORN.CODFORNEC = M.CODFORNEC
         INNER JOIN PCLOGDESBLOQUEIO DE ON (
             DE.CODPROD = M.CODPROD
             AND (
                 (DE.NUMTRANSENT IS NOT NULL AND DE.NUMTRANSENT = M.NUMTRANSENT)
                 OR
                 (DE.NUMBONUS IS NOT NULL AND DE.NUMBONUS > 0 AND DE.NUMBONUS = M.NUMBONUS)
             )
         )
         WHERE DE.DTDESBLOQUEIO >= :lastUnlockDate
         AND M.CODPROD = 17970
        `;

        const result = await conn.execute(query, { lastUnlockDate }, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
        console.log(result.rows);

        await conn.close();
    } catch (err) {
        logger.error(`Erro ao rodar query: ${err.message}`);
        console.error(err);
    } finally {
        await database.close();
    }
}

main();
