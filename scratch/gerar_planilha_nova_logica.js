require('dotenv').config();
const path = require('path');
const ExcelJS = require('exceljs');
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

// ===== Parâmetros da nova lógica =====
const J = 90;                 // janela de giro
const FREQ_CONTINUO = 12;     // >= dias com venda -> demanda contínua
const FREQ_MIN = 8;           // < dias -> sob demanda
const PICO_WINSOR = 0.40;     // maior dia >= 40% do total -> winsorizar
const PICO_SOBDEMANDA = 0.70; // maior dia >= 70% -> sob demanda
const OUT = path.join(__dirname, '..', 'data', 'relatorio_compras_NOVA_LOGICA.xlsx');

function classificar(r) {
    if (r.DIAS < FREQ_MIN || r.NCLI === 1 || r.PICO >= PICO_SOBDEMANDA) return 'SOB DEMANDA';
    if (r.PICO >= PICO_WINSOR) return 'IRREGULAR';
    return 'CONTINUO';
}
const round1 = (n) => Math.round(n * 10) / 10;

async function main() {
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    const sql = `
    WITH MOV AS (
      SELECT M.CODPROD, CASE WHEN M.CODFILIAL='6' THEN '20' ELSE M.CODFILIAL END FIL,
             TRUNC(M.DTMOV) DT, M.QT-NVL(M.QTDEVOL,0) QNET, M.CODCLI
      FROM PCMOV M WHERE M.CODOPER='S' AND M.DTMOV>=TRUNC(SYSDATE)-${J}
        AND M.CODFILIAL IN ('6','20','21','22','23')
    ),
    DIA AS (
      SELECT CODPROD, FIL, DT, SUM(QNET) DIA_NET,
        CASE WHEN DT>=TRUNC(SYSDATE)-${J}/3 THEN 3
             WHEN DT>=TRUNC(SYSDATE)-2*${J}/3 THEN 2 ELSE 1 END W
      FROM MOV GROUP BY CODPROD, FIL, DT
    ),
    CAPS AS (
      SELECT CODPROD, FIL, PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY DIA_NET) CAP
      FROM DIA GROUP BY CODPROD, FIL
    ),
    CLI AS ( SELECT CODPROD, FIL, COUNT(DISTINCT CODCLI) NCLI FROM MOV GROUP BY CODPROD, FIL ),
    AGG AS (
      SELECT D.CODPROD, D.FIL, COUNT(*) DIAS, SUM(D.DIA_NET) TOT, MAX(D.DIA_NET) MAIOR_DIA, C.CAP,
        SUM(D.W*D.DIA_NET)/(2*${J}) VDA_ATUAL,
        SUM(D.W*LEAST(D.DIA_NET,C.CAP))/(2*${J}) VDA_WINSOR,
        SUM(D.DIA_NET*GREATEST(NVL(NULLIF(0,0),0),1)) DUMMY
      FROM DIA D JOIN CAPS C ON C.CODPROD=D.CODPROD AND C.FIL=D.FIL
      GROUP BY D.CODPROD, D.FIL, C.CAP
    )
    SELECT A.CODPROD, A.FIL, P.DESCRICAO, P.EMBALAGEM, P.UNIDADE, P.CODFORNEC,
      FORN.FANTASIA FORNEC, NVL(FORN.PRAZOENTREGA,7) PRAZO, A.DIAS, CL.NCLI, A.TOT, A.MAIOR_DIA,
      A.VDA_ATUAL, A.VDA_WINSOR,
      (SELECT NVL(SUM(NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)),0) FROM PCEST E
         WHERE E.CODPROD=A.CODPROD AND ((A.FIL='20' AND E.CODFILIAL IN ('20','6')) OR (A.FIL<>'20' AND E.CODFILIAL=A.FIL))) ESTOQUE,
      (SELECT NVL(SUM(NVL(I.QTPEDIDA,0)-NVL(I.QTENTREGUE,0)),0) FROM PCITEM I JOIN PCPEDIDO PE ON I.NUMPED=PE.NUMPED
         WHERE I.CODPROD=A.CODPROD AND (I.QTPEDIDA-NVL(I.QTENTREGUE,0))>0 AND PE.DTPREVENT>=TRUNC(SYSDATE) AND PE.DTENTRADAESTOQUE IS NULL
           AND ((A.FIL='20' AND PE.CODFILIAL IN ('20','6')) OR (A.FIL<>'20' AND PE.CODFILIAL=A.FIL))) SALDO
    FROM AGG A
      JOIN PCPRODUT P ON P.CODPROD=A.CODPROD
      JOIN CLI CL ON CL.CODPROD=A.CODPROD AND CL.FIL=A.FIL
      LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC=P.CODFORNEC
    WHERE P.REVENDA='S' AND P.CODEPTO IN (1,2,3,7)
      AND P.CODFORNEC NOT IN (3,4,14566,14631,14574,14573) AND NVL(P.OBS2,' ')<>'FL'
      AND A.DIAS>=5 AND A.TOT>0
    ORDER BY FORN.FANTASIA, A.FIL, P.DESCRICAO`;

    const res = await conn.execute(sql, [], opt);
    await conn.close();

    // ===== pós-processamento (classificação + cobertura + status + sugestão) =====
    const linhas = res.rows.map(r => {
        const estoque = Number(r.ESTOQUE) || 0;
        const saldo = Number(r.SALDO) || 0;
        const prazo = Number(r.PRAZO) || 7;
        const vdaAtual = Number(r.VDA_ATUAL) || 0;
        const vdaWinsor = Number(r.VDA_WINSOR) || 0;
        const pico = r.TOT > 0 ? r.MAIOR_DIA / r.TOT : 0;
        const base = { ...r, PICO: pico, DIAS: Number(r.DIAS), NCLI: Number(r.NCLI) };
        const perfil = classificar(base);

        // venda diária usada por perfil
        const vdaUsada = perfil === 'IRREGULAR' ? vdaWinsor : vdaAtual;

        let status = 'SAUDAVEL', sugestao = 0, cobFis = 9999, cobTot = 9999;
        if (perfil !== 'SOB DEMANDA') {
            cobFis = vdaUsada > 0 ? round1(estoque / vdaUsada) : 9999;
            cobTot = vdaUsada > 0 ? round1((estoque + saldo) / vdaUsada) : 9999;
            if (cobFis >= prazo) status = 'SAUDAVEL';
            else if (cobTot < prazo) status = 'CRITICO';
            else status = 'ATENCAO';
            if (cobTot < prazo && vdaUsada > 0) {
                const raw = vdaUsada * prazo - (estoque + saldo);
                sugestao = estoque === 0 ? Math.max(1, Math.ceil(raw)) : Math.max(0, Math.round(raw));
            }
        }
        return {
            CODPROD: r.CODPROD, FIL: r.FIL,
            DESCRICAO: `${r.DESCRICAO} (${r.EMBALAGEM || 'UN'} ${r.UNIDADE || ''})`.trim(),
            FORNEC: r.FORNEC || `Forn ${r.CODFORNEC}`,
            PERFIL: perfil, DIAS: Number(r.DIAS), NCLI: Number(r.NCLI), PICO_PCT: Math.round(pico * 100),
            VDA_ATUAL: round1(vdaAtual), VDA_USADA: perfil === 'SOB DEMANDA' ? null : round1(vdaUsada),
            ESTOQUE: estoque, SALDO: saldo, PRAZO: prazo,
            COBERTURA: perfil === 'SOB DEMANDA' ? null : (cobFis === 9999 ? '∞' : cobFis),
            STATUS: perfil === 'SOB DEMANDA' ? 'REVISAR' : status,
            SUGESTAO: perfil === 'SOB DEMANDA' ? null : sugestao,
            VOL_90D: Math.round(r.TOT)
        };
    });

    // ===== workbook =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Brago App System';

    const fmtHeader = (ws) => {
        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        ws.getRow(1).alignment = { vertical: 'middle' };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };
    };

    // Aba 1: Resumo
    const r1 = wb.addWorksheet('Resumo');
    const porPerfil = {};
    linhas.forEach(l => { porPerfil[l.PERFIL] = (porPerfil[l.PERFIL] || 0) + 1; });
    const criticos = linhas.filter(l => l.STATUS === 'CRITICO').length;
    const aRevisar = linhas.filter(l => l.STATUS === 'REVISAR').length;
    r1.columns = [{ header: 'Indicador', key: 'k', width: 42 }, { header: 'Valor', key: 'v', width: 14 }];
    fmtHeader(r1);
    r1.addRows([
        { k: 'Total de itens (produto × filial)', v: linhas.length },
        { k: 'Perfil CONTÍNUO (sugestão automática)', v: porPerfil['CONTINUO'] || 0 },
        { k: 'Perfil IRREGULAR (winsorizado)', v: porPerfil['IRREGULAR'] || 0 },
        { k: 'Perfil SOB DEMANDA (revisar manual)', v: porPerfil['SOB DEMANDA'] || 0 },
        { k: 'Itens CRÍTICOS (comprar)', v: criticos },
        { k: 'Itens para REVISAR', v: aRevisar },
        { k: 'Parâmetros', v: '' },
        { k: '  Janela de giro (dias)', v: J },
        { k: '  Freq. mínima contínuo (dias)', v: FREQ_CONTINUO },
        { k: '  Freq. sob demanda (< dias)', v: FREQ_MIN },
        { k: '  Pico p/ winsorizar (% do maior dia)', v: `${PICO_WINSOR * 100}%` },
        { k: '  Pico p/ sob demanda (% do maior dia)', v: `${PICO_SOBDEMANDA * 100}%` },
        { k: '  Corte da winsorização', v: 'P90 dos dias' }
    ]);

    const cols = [
        { header: 'Fornecedor', key: 'FORNEC', width: 26 },
        { header: 'Filial', key: 'FIL', width: 8 },
        { header: 'Cód', key: 'CODPROD', width: 9 },
        { header: 'Descrição', key: 'DESCRICAO', width: 40 },
        { header: 'Perfil', key: 'PERFIL', width: 13 },
        { header: 'Dias c/ venda', key: 'DIAS', width: 12 },
        { header: 'Clientes', key: 'NCLI', width: 9 },
        { header: 'Pico %', key: 'PICO_PCT', width: 8 },
        { header: 'Venda/dia ATUAL', key: 'VDA_ATUAL', width: 15 },
        { header: 'Venda/dia USADA', key: 'VDA_USADA', width: 15 },
        { header: 'Estoque', key: 'ESTOQUE', width: 10 },
        { header: 'Saldo Ped.', key: 'SALDO', width: 10 },
        { header: 'Prazo Forn.', key: 'PRAZO', width: 10 },
        { header: 'Cobertura (d)', key: 'COBERTURA', width: 12 },
        { header: 'Status', key: 'STATUS', width: 11 },
        { header: 'Sugestão Compra', key: 'SUGESTAO', width: 15 },
        { header: 'Volume 90d', key: 'VOL_90D', width: 11 }
    ];
    const corStatus = { CRITICO: 'FFFEE2E2', ATENCAO: 'FFEFF6FF', SAUDAVEL: 'FFF0FDF4', REVISAR: 'FFFEF9C3' };

    const addGrid = (ws, rows) => {
        ws.columns = cols; fmtHeader(ws);
        rows.forEach(l => {
            const row = ws.addRow(l);
            const fill = corStatus[l.STATUS];
            if (fill) row.getCell('STATUS').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
            if (l.STATUS === 'CRITICO') row.getCell('SUGESTAO').font = { bold: true, color: { argb: 'FFB91C1C' } };
        });
    };

    // Aba 2: Sugestão de compra (continuo + irregular), críticos primeiro
    const auto = linhas.filter(l => l.PERFIL !== 'SOB DEMANDA')
        .sort((a, b) => {
            const ord = { CRITICO: 0, ATENCAO: 1, SAUDAVEL: 2 };
            if (ord[a.STATUS] !== ord[b.STATUS]) return ord[a.STATUS] - ord[b.STATUS];
            return (b.SUGESTAO || 0) - (a.SUGESTAO || 0);
        });
    addGrid(wb.addWorksheet('Sugestão de Compra'), auto);

    // Aba 3: Revisar (sob demanda)
    const rev = linhas.filter(l => l.PERFIL === 'SOB DEMANDA')
        .sort((a, b) => b.VOL_90D - a.VOL_90D);
    addGrid(wb.addWorksheet('Revisar (Sob Demanda)'), rev);

    await wb.xlsx.writeFile(OUT);
    console.log(`\n✅ Planilha gerada: ${OUT}`);
    console.log(`Total: ${linhas.length} | CONTÍNUO: ${porPerfil['CONTINUO']||0} | IRREGULAR: ${porPerfil['IRREGULAR']||0} | SOB DEMANDA: ${porPerfil['SOB DEMANDA']||0}`);
    console.log(`Críticos (comprar): ${criticos} | Revisar: ${aRevisar}`);

    await database.close();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
