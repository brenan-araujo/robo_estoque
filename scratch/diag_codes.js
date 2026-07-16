require('dotenv').config();
const db = require('../src/config/database');

const CODES = [16487, 16637, 16489, 16490, 16491, 16639, 16492, 16929];

const SQL = `
SELECT * FROM (
  SELECT
    P.CODPROD, F.CODFILIAL,
    P.REVENDA, P.DTEXCLUSAO, P.CODEPTO, P.IONSYNC,
    F.PROIBIDAVENDA, F.FORALINHA, F.ATIVO, F.ENVIARFORCAVENDAS,
    (NVL(EST.QTESTGER,0)-NVL(EST.QTRESERV,0)-NVL(EST.QTBLOQUEADA,0)-NVL(EST.QTINDENIZ,0)) AS QTDISP,
    NVL(EST.QTESTGER,0) AS QTESTGER, NVL(EST.QTRESERV,0) AS QTRESERV,
    NVL(EST.QTBLOQUEADA,0) AS QTBLOQ, NVL(EST.QTINDENIZ,0) AS QTINDEN,
    NVL(TAB.PVENDA,0) AS PVENDA, TAB.CODST,
    NVL(EST.CUSTOFIN,0) AS CUSTOFIN, NVL(EST.CUSTOREP,0) AS CUSTOREP, NVL(EST.CUSTOREAL,0) AS CUSTOREAL,
    CASE
      WHEN P.REVENDA='S' AND P.DTEXCLUSAO IS NULL AND F.PROIBIDAVENDA='N' AND F.FORALINHA='N'
       AND F.ATIVO='S' AND F.ENVIARFORCAVENDAS='S' AND P.IONSYNC='Y'
       AND NVL(TAB.PVENDA,0)>0 AND NVL(EST.CUSTOFIN,0)>0 AND NVL(EST.CUSTOREP,0)>0
       AND NVL(EST.CUSTOREAL,0)>0 AND TAB.CODST IS NOT NULL
      THEN 'PRODUTO_NA_ION' ELSE 'FALTA_REVISAR' END AS STATUS,
    ROW_NUMBER() OVER (PARTITION BY P.CODPROD, F.CODFILIAL
       ORDER BY CASE WHEN REG.CODFILIAL=F.CODFILIAL THEN 0 ELSE 1 END, REG.NUMREGIAO) AS RN
  FROM PCPRODUT P
  JOIN PCPRODFILIAL F ON P.CODPROD=F.CODPROD
  INNER JOIN PCREGIAO REG ON (REG.CODFILIAL=F.CODFILIAL OR REG.CODFILIAL='99')
  LEFT JOIN PCTABPR TAB ON (TAB.CODPROD=F.CODPROD AND TAB.NUMREGIAO=REG.NUMREGIAO)
  LEFT JOIN PCEST EST ON (EST.CODPROD=F.CODPROD AND EST.CODFILIAL=F.CODFILIAL)
  WHERE P.CODPROD IN (${CODES.join(',')})
    AND F.CODFILIAL IN (6,20,21,22,23)
    AND REG.STATUS NOT IN ('I','C')
) WHERE RN=1
ORDER BY CODPROD, CODFILIAL`;

function motivo(r) {
    if (r.CODEPTO === 6 || r.CODEPTO === 103) return `FORA: departamento ${r.CODEPTO} (excluído 6/103)`;
    if (r.REVENDA !== 'S') return `FORA: REVENDA=${r.REVENDA} (não é 'S')`;
    if (r.DTEXCLUSAO) return `FORA: produto excluído (DTEXCLUSAO)`;
    if (r.PROIBIDAVENDA === 'S') return `FORA: venda proibida na filial`;
    if (r.STATUS === 'PRODUTO_NA_ION') return `FORA: JÁ integrado na ION (não é pendência)`;
    if (Number(r.QTDISP) <= 0) return `FORA: sem estoque disp. (ger ${r.QTESTGER} - res ${r.QTRESERV} - bloq ${r.QTBLOQ} - inden ${r.QTINDEN} = ${r.QTDISP})`;
    return `DEVERIA APARECER (FALTA_REVISAR + estoque ${r.QTDISP})`;
}

async function main() {
    await db.initialize();
    let conn;
    try {
        conn = await db.getConnection();
        const res = await conn.execute(SQL, [], { outFormat: db.oracledb.OUT_FORMAT_OBJECT });
        const rows = res.rows || [];
        const byCode = {};
        rows.forEach(r => { (byCode[r.CODPROD] = byCode[r.CODPROD] || []).push(r); });
        for (const code of CODES) {
            console.log(`\n===== CÓD ${code} =====`);
            const rs = byCode[code];
            if (!rs || !rs.length) { console.log('  (sem cadastro nas filiais 6/20/21/22/23 — ou não existe)'); continue; }
            rs.forEach(r => {
                console.log(`  Filial ${String(r.CODFILIAL).padEnd(2)} | ${r.STATUS.padEnd(14)} | est.ger ${String(r.QTESTGER).padEnd(6)} disp ${String(r.QTDISP).padEnd(6)} | ${motivo(r)}`);
            });
        }
    } finally {
        if (conn) { try { await conn.close(); } catch (e) {} }
        await db.close();
    }
}
main().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
