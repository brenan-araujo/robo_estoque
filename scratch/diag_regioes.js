require('dotenv').config();
const db = require('../src/config/database');

const CODES = [16487, 16929, 16489];

const SQL = `
  SELECT
    P.CODPROD, F.CODFILIAL,
    REG.NUMREGIAO, REG.CODFILIAL AS REG_FIL, REG.STATUS AS REG_ST,
    NVL(TAB.PVENDA,0) AS PVENDA, TAB.CODST,
    (NVL(EST.QTESTGER,0)-NVL(EST.QTRESERV,0)-NVL(EST.QTBLOQUEADA,0)-NVL(EST.QTINDENIZ,0)) AS QTDISP,
    CASE
      WHEN P.REVENDA='S' AND P.DTEXCLUSAO IS NULL AND F.PROIBIDAVENDA='N' AND F.FORALINHA='N'
       AND F.ATIVO='S' AND F.ENVIARFORCAVENDAS='S' AND P.IONSYNC='Y'
       AND NVL(TAB.PVENDA,0)>0 AND NVL(EST.CUSTOFIN,0)>0 AND NVL(EST.CUSTOREP,0)>0
       AND NVL(EST.CUSTOREAL,0)>0 AND TAB.CODST IS NOT NULL
      THEN 'NA_ION' ELSE 'PENDENTE' END AS STATUS,
    CASE WHEN REG.CODFILIAL=F.CODFILIAL THEN 0 ELSE 1 END AS PRIORIDADE_RN
  FROM PCPRODUT P
  JOIN PCPRODFILIAL F ON P.CODPROD=F.CODPROD
  INNER JOIN PCREGIAO REG ON (REG.CODFILIAL=F.CODFILIAL OR REG.CODFILIAL='99')
  LEFT JOIN PCTABPR TAB ON (TAB.CODPROD=F.CODPROD AND TAB.NUMREGIAO=REG.NUMREGIAO)
  LEFT JOIN PCEST EST ON (EST.CODPROD=F.CODPROD AND EST.CODFILIAL=F.CODFILIAL)
  WHERE P.CODPROD IN (${CODES.join(',')})
    AND F.CODFILIAL IN (6,20,21,22,23)
    AND REG.STATUS NOT IN ('I','C')
  ORDER BY P.CODPROD, F.CODFILIAL, PRIORIDADE_RN, REG.NUMREGIAO`;

async function main() {
    await db.initialize();
    let conn;
    try {
        conn = await db.getConnection();
        const res = await conn.execute(SQL, [], { outFormat: db.oracledb.OUT_FORMAT_OBJECT });
        const rows = res.rows || [];
        let lastKey = '';
        rows.forEach(r => {
            const key = `${r.CODPROD}-${r.CODFILIAL}`;
            if (key !== lastKey) { console.log(`\n--- Cód ${r.CODPROD} | Filial ${r.CODFILIAL} | estoque ${r.QTDISP} ---`); lastKey = key; }
            const own = r.REG_FIL == r.CODFILIAL ? 'própria' : `reg-fil ${r.REG_FIL}`;
            console.log(`   região ${String(r.NUMREGIAO).padEnd(4)} (${own.padEnd(10)}) | PVENDA ${String(r.PVENDA).padEnd(8)} | CODST ${String(r.CODST||'—').padEnd(5)} | ${r.STATUS}`);
        });
    } finally {
        if (conn) { try { await conn.close(); } catch (e) {} }
        await db.close();
    }
}
main().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
