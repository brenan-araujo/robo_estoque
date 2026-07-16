const oracledb = require('oracledb');
require('dotenv').config();

oracledb.initOracleClient({ libDir: 'C:\\Users\\usuario001\\Documents\\api_consulta_estoque\\oracle_client\\instantclient_23_4' });

async function checkRca() {
    let connection;
    try {
        connection = await oracledb.getConnection({
            user: 'COMODATO',
            password: 'C0M0D4T0',
            connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=10.2.4.2)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=BRAG6010)))'
        });
        console.log('✅ Connected!');

        const targetDate = '2026-05-28';

        // Query to get RCA breakdown
        const result = await connection.execute(
            `WITH 
             -- Base de RCAs com meta no dia
             RCAS AS (
                 SELECT DISTINCT M.CODUSUR, U.NOME
                 FROM PCMETARCA M
                 JOIN PCUSUARI U ON U.CODUSUR = M.CODUSUR
                 WHERE M.DATA = TO_DATE(:dt, 'YYYY-MM-DD')
                 AND U.BLOQUEIO = 'N'
             ),
             -- Carteira por RCA
             CARTEIRA AS (
                 SELECT cl.CODUSUR1 AS CODUSUR, COUNT(*) AS QTY_CARTEIRA
                 FROM PCCLIENT cl
                 WHERE cl.BLOQUEIO IS NULL OR cl.BLOQUEIO = 'N'
                 GROUP BY cl.CODUSUR1
             ),
             -- Vendas Brutas e Positivados hoje por RCA
             VENDAS_HOJE AS (
                 SELECT F.CODUSUR, 
                        COUNT(DISTINCT F.CODCLI) AS QTY_POSITIVADOS,
                        NVL(SUM(F.VLTOTAL), 0) AS VALOR_BRUTO
                 FROM PCNFSAID F
                 WHERE F.DTSAIDA >= TO_DATE(:dt, 'YYYY-MM-DD')
                 AND F.DTSAIDA < TO_DATE(:dt, 'YYYY-MM-DD') + 1
                 AND F.DTCANCEL IS NULL
                 AND F.CONDVENDA IN (1, 7, 9)
                 GROUP BY F.CODUSUR
             ),
             -- Devoluções hoje por RCA
             DEVOL_HOJE AS (
                 SELECT M.CODUSUR, 
                        NVL(SUM(M.QT * M.PUNIT), 0) AS VALOR_DEVOL
                 FROM PCMOV M
                 WHERE M.DTMOV >= TO_DATE(:dt, 'YYYY-MM-DD')
                 AND M.DTMOV < TO_DATE(:dt, 'YYYY-MM-DD') + 1
                 AND M.CODOPER = 'ED'
                 GROUP BY M.CODUSUR
             ),
             -- Novos Clientes hoje por RCA
             NOVOS_HOJE AS (
                 SELECT cl.CODUSUR1 AS CODUSUR, COUNT(*) AS QTY_NOVOS
                 FROM PCCLIENT cl
                 WHERE cl.DTCADASTRO >= TO_DATE(:dt, 'YYYY-MM-DD')
                 AND cl.DTCADASTRO < TO_DATE(:dt, 'YYYY-MM-DD') + 1
                 GROUP BY cl.CODUSUR1
             ),
             -- Reativados hoje por RCA
             REATIVADOS_HOJE AS (
                 SELECT F.CODUSUR, COUNT(DISTINCT F.CODCLI) AS QTY_REATIVADOS
                 FROM PCNFSAID F
                 JOIN PCCLIENT cl ON cl.CODCLI = F.CODCLI
                 WHERE F.DTSAIDA >= TO_DATE(:dt, 'YYYY-MM-DD')
                 AND F.DTSAIDA < TO_DATE(:dt, 'YYYY-MM-DD') + 1
                 AND F.DTCANCEL IS NULL
                 AND F.CONDVENDA IN (1, 7, 9)
                 AND NOT EXISTS (
                     SELECT 1 FROM PCNFSAID F2
                     WHERE F2.CODCLI = F.CODCLI
                     AND F2.DTCANCEL IS NULL
                     AND F2.CONDVENDA IN (1, 7, 9)
                     AND F2.DTSAIDA BETWEEN TO_DATE(:dt, 'YYYY-MM-DD') - 180 AND TO_DATE(:dt, 'YYYY-MM-DD') - 1
                 )
                 AND cl.DTCADASTRO < TO_DATE(:dt, 'YYYY-MM-DD')
                 GROUP BY F.CODUSUR
             )
             SELECT 
                 R.CODUSUR,
                 R.NOME,
                 NVL(C.QTY_CARTEIRA, 0) AS CARTEIRA,
                 NVL(V.QTY_POSITIVADOS, 0) AS POSITIVADOS,
                 NVL(N.QTY_NOVOS, 0) AS NOVOS,
                 NVL(RE.QTY_REATIVADOS, 0) AS REATIVADOS,
                 NVL(V.VALOR_BRUTO, 0) - NVL(D.VALOR_DEVOL, 0) AS LIQUIDO
             FROM RCAS R
             LEFT JOIN CARTEIRA C ON C.CODUSUR = R.CODUSUR
             LEFT JOIN VENDAS_HOJE V ON V.CODUSUR = R.CODUSUR
             LEFT JOIN DEVOL_HOJE D ON D.CODUSUR = R.CODUSUR
             LEFT JOIN NOVOS_HOJE N ON N.CODUSUR = R.CODUSUR
             LEFT JOIN REATIVADOS_HOJE RE ON RE.CODUSUR = R.CODUSUR
             WHERE NVL(V.QTY_POSITIVADOS, 0) > 0 OR NVL(N.QTY_NOVOS, 0) > 0 OR NVL(RE.QTY_REATIVADOS, 0) > 0
             ORDER BY LIQUIDO DESC`,
            { dt: targetDate },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        console.log(`RCAs active on ${targetDate}: ${result.rows.length}`);
        let totalCarteira = 0;
        let totalPositivados = 0;
        let totalNovos = 0;
        let totalReativados = 0;
        let totalLiquido = 0;

        result.rows.forEach((row, i) => {
            totalCarteira += row.CARTEIRA;
            totalPositivados += row.POSITIVADOS;
            totalNovos += row.NOVOS;
            totalReativados += row.REATIVADOS;
            totalLiquido += row.LIQUIDO;
            console.log(`RCA ${row.CODUSUR}: ${row.NOME.substring(0, 15)} | Cart=${row.CARTEIRA} | Pos=${row.POSITIVADOS} | Novos=${row.NOVOS} | Reat=${row.REATIVADOS} | Liq=R$ ${row.LIQUIDO.toFixed(2)}`);
        });

        console.log(`\nTotals:`);
        console.log(`Carteira: ${totalCarteira}`);
        console.log(`Positivados: ${totalPositivados}`);
        console.log(`Novos: ${totalNovos}`);
        console.log(`Reativados: ${totalReativados}`);
        console.log(`Líquido: R$ ${totalLiquido.toFixed(2)}`);

    } catch (err) {
        console.error(err);
    } finally {
        if (connection) await connection.close();
    }
}

checkRca();
