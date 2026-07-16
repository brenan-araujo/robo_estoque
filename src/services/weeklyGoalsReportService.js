const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CronJob } = require('cron');
const { getConnection, oracledb } = require('../config/database');
const whatsapp = require('./whatsappService');
const logger = require('../utils/logger');

const LOGO_PATH = path.join(__dirname, '..', '..', 'data', 'brago_logo.png');
const PDF_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_metas_semanal.pdf');
const PDF_DRYRUN_PATH = path.join(__dirname, '..', '..', 'data', 'relatorio_metas_semanal_dryrun.pdf');

// Vendedores acompanhados e destinatários do envio semanal.
// Metas têm horizonte trimestral mas são lançadas mensalmente:
//  - meses 1 e 2 do trimestre -> relatório cobre o MÊS corrente (este arquivo);
//  - mês 3 -> entram as metas trimestrais de fornecedor (PCMETAFORNEC) — seção futura.
const SELLERS = [{ rca: 93, filial: '20' }];
const NOTIFY_NUMBERS = ['5562996101684', '5561983391951']; // Brenan Marketing + Brenan Araújo
const CRON_TIME = '30 07 * * 5'; // sexta-feira 07:30 — resumo p/ o Brenan (RCA fixo)
const MASS_CRON_TIME = '00 17 * * 5'; // sexta-feira 17:00 — envio em massa p/ TODOS os vendedores

let cronJob = null;
let massCronJob = null;

// ===================== helpers de data/formatação =====================
const BRL = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRL0 = (n) => 'R$ ' + Math.round(Number(n || 0)).toLocaleString('pt-BR');
const PCT = (r, m) => (m > 0 ? (r / m) * 100 : 0);
const F1 = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const D = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const ORA = (d) => d.toLocaleDateString('pt-BR'); // DD/MM/YYYY para binds TO_DATE

function mondayOf(date) {
    const x = new Date(date);
    const dow = x.getDay();
    x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow));
    x.setHours(0, 0, 0, 0);
    return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// Converte refDate em Date LOCAL. new Date('YYYY-MM-DD') interpreta como UTC
// meia-noite, que em Brasília (UTC-3) recua para o dia ANTERIOR — o relatório
// passava a ignorar as vendas do próprio dia de referência (bug de 13/07/2026,
// diferenças de exatamente 1 dia de venda vs o relatório oficial).
function parseLocalDate(v) {
    if (v instanceof Date) return new Date(v);
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(v);
}
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ===================== coleta de dados =====================
async function gatherSellerData(conn, rca, filial, ref) {
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    const one = async (sql, b) => (await conn.execute(sql, b, opt)).rows[0] || {};
    const all = async (sql, b) => (await conn.execute(sql, b, opt)).rows;

    const mesIni = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const mesFim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const segunda = mondayOf(ref);
    const sexta = addDays(segunda, 4);
    const proxSeg = addDays(segunda, 7);
    const proxSex = addDays(segunda, 11);
    const mesTrimestre = (ref.getMonth() % 3) + 1; // 1, 2 ou 3

    const usr = await one(`SELECT NOME, CODSUPERVISOR FROM PCUSUARI WHERE CODUSUR = :c`, { c: rca });

    // ---- metas do mês ----
    const meta = await one(
        `SELECT SUM(NVL(VLVENDAPREV,0)) MV, SUM(NVL(QTPEDPREV,0)) MA, SUM(NVL(QTITENSPEDPREV,0)) MR
         FROM PCMETARCA WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
        { c: rca, di: ORA(mesIni), df: ORA(mesFim) });
    const metaM = await one(
        `SELECT MAX(MIXPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) MIX,
                MAX(CLIPOSPREV) KEEP (DENSE_RANK LAST ORDER BY DATA) POS
         FROM PCMETA WHERE CODUSUR=:c AND TIPOMETA='M' AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
        { c: rca, di: ORA(mesIni), df: ORA(mesFim) });

    // ---- realizado do mês (até agora) ----
    // IMPORTANTE: a META (PCMETARCA/PCMETA) é por CODUSUR SEM filtrar filial, ou seja,
    // é o total do vendedor. Então o REALIZADO também NÃO filtra filial — soma todas as
    // filiais do vendedor. Fixar uma filial fazia multi-filial (ex.: Ines f20+f21+f22,
    // Tayane f20+f6, Maira toda na f21) baterem errado (até -100%). Confere com o
    // relatório oficial por supervisor, que também soma todas as filiais.
    const B = { c: rca, di: ORA(mesIni), df: ORA(ref) };
    // Venda pela PCMOV (QT*PUNIT, operação 'S') — bate centavo por centavo com o
    // cálculo oficial do WinThor (VIEW_VENDAS_RESUMO_FATURAMENTO). Antes usava
    // PCNFSAID.VLTOTAL, que é o total da nota (com IPI/frete/despesas) e inflava o
    // realizado em até ~36%. A devolução (dv) já usava PCMOV 'ED' corretamente.
    const vb = await one(
        `SELECT NVL(SUM(QT*PUNIT + NVL(VLFRETE,0)),0) V FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='S'
           AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`, B);
    const dv = await one(
        `SELECT NVL(SUM(QT*PUNIT + NVL(VLFRETE,0)),0) V FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='ED'
           AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`, B);
    const pos = await one(
        `SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC
         WHERE CODUSUR=:c AND DTCANCEL IS NULL AND CONDVENDA IN (1,7,9,14)
           AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`, B);
    const nov = await one(
        `SELECT COUNT(DISTINCT cl.codcli) N FROM pcclient cl
         JOIN pcmov pm ON pm.codcli=cl.codcli
         JOIN pcpedc pp ON pp.numped=pm.numped AND pp.dtcancel IS NULL AND pp.condvenda IN (1,7,9,14) AND pp.vltotal>=120
         WHERE pm.codoper='S' AND pm.codusur=:c
           AND pm.dtmov BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
           AND NOT EXISTS (SELECT 1 FROM pcmov pm2 WHERE pm2.codcli=cl.codcli AND pm2.codoper='S' AND pm2.dtmov<TO_DATE(:di,'DD/MM/YYYY'))`, B);
    const rea = await one(
        `SELECT COUNT(DISTINCT CODCLI) N FROM PCPEDC PE
         WHERE PE.CODUSUR=:c AND PE.DTCANCEL IS NULL AND PE.CONDVENDA IN (1,7,9,14)
           AND PE.POSICAO='F' AND PE.VLTOTAL>=120
           AND PE.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
           AND NOT EXISTS (SELECT 1 FROM PCPEDC P WHERE P.CODCLI=PE.CODCLI AND P.DTCANCEL IS NULL AND P.CONDVENDA IN (1,7,9,14) AND P.POSICAO='F'
                AND P.DATA BETWEEN ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6) AND ADD_MONTHS(TO_DATE(:df,'DD/MM/YYYY'),-1))
           AND EXISTS (SELECT 1 FROM PCPEDC P3 WHERE P3.CODCLI=PE.CODCLI AND P3.DTCANCEL IS NULL AND P3.CONDVENDA IN (1,7,9,14) AND P3.POSICAO='F'
                AND P3.DATA < ADD_MONTHS(TO_DATE(:di,'DD/MM/YYYY'),-6))`, B);
    const mix = await one(
        `SELECT COUNT(DISTINCT CODPROD) N FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='S'
           AND DTMOV BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`, B);

    // ---- semana corrente ----
    const metaSemFull = await one(
        `SELECT NVL(SUM(NVL(VLVENDAPREV,0)),0) M FROM PCMETARCA
         WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
        { c: rca, di: ORA(segunda), df: ORA(sexta) });
    const metaSemAte = await one(
        `SELECT NVL(SUM(NVL(VLVENDAPREV,0)),0) M FROM PCMETARCA
         WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
        { c: rca, di: ORA(segunda), df: ORA(ref) });
    const vbSem = await one(
        `SELECT NVL(SUM(QT*PUNIT + NVL(VLFRETE,0)),0) V FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='S'
           AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`,
        { c: rca, di: ORA(segunda), df: ORA(ref) });
    const dvSem = await one(
        `SELECT NVL(SUM(QT*PUNIT + NVL(VLFRETE,0)),0) V FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='ED'
           AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1`,
        { c: rca, di: ORA(segunda), df: ORA(ref) });

    // ---- dias úteis (calendário da filial) ----
    const du = await one(
        `SELECT COUNT(*) TOT, SUM(CASE WHEN DATA < TRUNC(SYSDATE) THEN 1 ELSE 0 END) DEC
         FROM PCDIASUTEIS WHERE DIAVENDAS='S' AND CODFILIAL=:fil
           AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
        { fil: filial, di: ORA(mesIni), df: ORA(mesFim) });
    const duProx = await one(
        `SELECT COUNT(*) N FROM PCDIASUTEIS WHERE DIAVENDAS='S' AND CODFILIAL=:fil
           AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')`,
        { fil: filial, di: ORA(proxSeg), df: ORA(proxSex) });

    // ---- semanas do mês (gráfico meta x realizado) ----
    const wMeta = await all(
        `SELECT TRUNC(DATA,'IW') W, SUM(NVL(VLVENDAPREV,0)) M FROM PCMETARCA
         WHERE CODUSUR=:c AND DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
         GROUP BY TRUNC(DATA,'IW') ORDER BY W`,
        { c: rca, di: ORA(mesIni), df: ORA(ref) });
    const wVnd = await all(
        `SELECT TRUNC(DTMOV,'IW') W, SUM(QT*PUNIT + NVL(VLFRETE,0)) V FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='S'
           AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1
         GROUP BY TRUNC(DTMOV,'IW') ORDER BY W`,
        { c: rca, di: ORA(mesIni), df: ORA(ref) });
    const wDev = await all(
        `SELECT TRUNC(DTMOV,'IW') W, SUM(NVL(QT*PUNIT + NVL(VLFRETE,0),0)) V FROM PCMOV
         WHERE CODUSUR=:c AND CODOPER='ED'
           AND DTMOV>=TO_DATE(:di,'DD/MM/YYYY') AND DTMOV<TO_DATE(:df,'DD/MM/YYYY')+1
         GROUP BY TRUNC(DTMOV,'IW') ORDER BY W`,
        { c: rca, di: ORA(mesIni), df: ORA(ref) });
    const wkMap = {};
    wMeta.forEach(r => { const k = new Date(r.W).getTime(); wkMap[k] = wkMap[k] || { w: new Date(r.W), meta: 0, real: 0 }; wkMap[k].meta += Number(r.M) || 0; });
    wVnd.forEach(r => { const k = new Date(r.W).getTime(); wkMap[k] = wkMap[k] || { w: new Date(r.W), meta: 0, real: 0 }; wkMap[k].real += Number(r.V) || 0; });
    wDev.forEach(r => { const k = new Date(r.W).getTime(); if (wkMap[k]) wkMap[k].real -= Number(r.V) || 0; });
    const semanasMes = Object.values(wkMap).sort((a, b) => a.w - b.w);

    // ---- datas do trimestre (usadas por fornecedores e inteligência comercial) ----
    const qIdx = Math.floor(ref.getMonth() / 3);
    const qIni = new Date(ref.getFullYear(), qIdx * 3, 1);
    const qFim = new Date(ref.getFullYear(), qIdx * 3 + 3, 0);
    const pqIni = new Date(ref.getFullYear(), qIdx * 3 - 3, 1);
    const pqFim = new Date(ref.getFullYear(), qIdx * 3, 0);
    const qElapsed = Math.max((ref - qIni) / 86400000 + 1, 1);
    const qTotalDays = (qFim - qIni) / 86400000 + 1;
    const qFrac = Math.min(qElapsed / qTotalDays, 1);

    // ---- metas por fornecedor (PCMETA TIPOMETA='F': linhas diárias; CODIGO = CODFORNEC) ----
    // Metas de fornecedor têm abrangência TRIMESTRAL (lançadas mensalmente):
    // meta = soma do trimestre; realizado = vendas do trimestre até hoje.
    const fornMeta = await all(
        `SELECT M.CODIGO COD, NVL(F.FANTASIA, 'FORN ' || M.CODIGO) NOME, SUM(NVL(M.VLVENDAPREV, 0)) META
         FROM PCMETA M LEFT JOIN PCFORNEC F ON F.CODFORNEC = M.CODIGO
         WHERE M.CODUSUR=:c AND M.TIPOMETA='F'
           AND M.DATA BETWEEN TO_DATE(:di,'DD/MM/YYYY') AND TO_DATE(:df,'DD/MM/YYYY')
         GROUP BY M.CODIGO, NVL(F.FANTASIA, 'FORN ' || M.CODIGO)
         ORDER BY META DESC`,
        { c: rca, di: ORA(qIni), df: ORA(qFim) });
    const fornReal = await all(
        `SELECT P.CODFORNEC COD, SUM((M.QT - NVL(M.QTDEVOL, 0)) * M.PUNIT) V
         FROM PCMOV M JOIN PCPRODUT P ON P.CODPROD = M.CODPROD
         WHERE M.CODUSUR=:c AND M.CODFILIAL=:fil AND M.CODOPER='S'
           AND M.DTMOV >= TO_DATE(:di,'DD/MM/YYYY') AND M.DTMOV < TO_DATE(:df,'DD/MM/YYYY') + 1
         GROUP BY P.CODFORNEC`,
        { c: rca, fil: filial, di: ORA(qIni), df: ORA(ref) });
    const fornRealMap = {};
    fornReal.forEach(r => { fornRealMap[r.COD] = Number(r.V) || 0; });
    const fornecedores = fornMeta
        .filter(r => (Number(r.META) || 0) > 0)
        .map(r => ({ cod: r.COD, nome: r.NOME, meta: Number(r.META) || 0, real: fornRealMap[r.COD] || 0 }));

    // ---- inteligência comercial (usa as datas de trimestre calculadas acima) ----
    // Faturamento por cliente no trimestre ANTERIOR (base da curva A 80/20)
    const cliPrevQ = await all(
        `SELECT N.CODCLI, NVL(C.FANTASIA, C.CLIENTE) NOME, SUM(N.VLTOTAL) V
         FROM PCNFSAID N JOIN PCCLIENT C ON C.CODCLI = N.CODCLI
         WHERE N.CODUSUR=:c AND N.CODFILIAL=:fil AND N.DTCANCEL IS NULL AND N.CONDVENDA IN (1,7,9,14)
           AND N.DTSAIDA >= TO_DATE(:di,'DD/MM/YYYY') AND N.DTSAIDA < TO_DATE(:df,'DD/MM/YYYY') + 1
         GROUP BY N.CODCLI, NVL(C.FANTASIA, C.CLIENTE) ORDER BY V DESC`,
        { c: rca, fil: filial, di: ORA(pqIni), df: ORA(pqFim) });
    // Faturamento por cliente no trimestre ATUAL (até hoje)
    const cliCurQ = await all(
        `SELECT N.CODCLI, SUM(N.VLTOTAL) V FROM PCNFSAID N
         WHERE N.CODUSUR=:c AND N.CODFILIAL=:fil AND N.DTCANCEL IS NULL AND N.CONDVENDA IN (1,7,9,14)
           AND N.DTSAIDA >= TO_DATE(:di,'DD/MM/YYYY') AND N.DTSAIDA < TO_DATE(:df,'DD/MM/YYYY') + 1
         GROUP BY N.CODCLI`,
        { c: rca, fil: filial, di: ORA(qIni), df: ORA(ref) });
    const curMap = {};
    cliCurQ.forEach(r => { curMap[r.CODCLI] = Number(r.V) || 0; });
    const totalPrevQ = cliPrevQ.reduce((a, r) => a + (Number(r.V) || 0), 0);
    let acum = 0;
    const curvaARows = [];
    for (const r of cliPrevQ) {
        if (totalPrevQ > 0 && acum / totalPrevQ < 0.8) {
            const q2 = Number(r.V) || 0;
            const atual = curMap[r.CODCLI] || 0;
            curvaARows.push({
                cod: r.CODCLI, nome: r.NOME, q2, atual,
                part: PCT(q2, totalPrevQ),
                ok: atual >= q2 * qFrac // no ritmo para bater o tri anterior
            });
            acum += q2;
        }
    }

    // Clientes da carteira SEM COMPRA (última compra por qualquer vendedor) por faixas
    const inativosAll = await all(
        `SELECT C.CODCLI, NVL(C.FANTASIA, C.CLIENTE) NOME,
                TRUNC(SYSDATE) - TRUNC(MAX(N.DTSAIDA)) DIAS,
                SUM(CASE WHEN N.DTSAIDA >= ADD_MONTHS(TRUNC(SYSDATE), -12) THEN N.VLTOTAL ELSE 0 END) V12M
         FROM PCCLIENT C JOIN PCNFSAID N ON N.CODCLI = C.CODCLI AND N.DTCANCEL IS NULL AND N.CONDVENDA IN (1,7,9,14)
         WHERE C.CODUSUR1 = :c
         GROUP BY C.CODCLI, NVL(C.FANTASIA, C.CLIENTE)
         HAVING TRUNC(SYSDATE) - TRUNC(MAX(N.DTSAIDA)) > 30
         ORDER BY V12M DESC`, { c: rca });
    const inat = inativosAll.map(r => ({ cod: r.CODCLI, nome: r.NOME, dias: Number(r.DIAS), v12m: Number(r.V12M) || 0 }));
    const inativos = {
        f3060: inat.filter(r => r.dias <= 60),
        f6090: inat.filter(r => r.dias > 60 && r.dias <= 90),
        f90: inat.filter(r => r.dias > 90)
    };
    const inatSet = new Set(inat.map(r => String(r.cod)));
    curvaARows.forEach(r => { r.inativoDias = inatSet.has(String(r.cod)) ? (inat.find(x => String(x.cod) === String(r.cod)) || {}).dias : null; });

    // ---- montagem ----
    const metaVenda = Number(meta.MV) || 0;
    const realizado = (Number(vb.V) || 0) - (Number(dv.V) || 0);
    const totDU = Number(du.TOT) || 0;
    const decDU = Number(du.DEC) || 0;
    const restDU = Math.max(totDU - decDU, 1);
    const gap = Math.max(metaVenda - realizado, 0);
    const ritmoAtual = decDU > 0 ? realizado / decDU : 0;
    const precisaDia = gap / restDU;
    const projecao = realizado + ritmoAtual * restDU;
    const esperadoHoje = totDU > 0 ? metaVenda * (decDU / totDU) : 0;
    const realSem = (Number(vbSem.V) || 0) - (Number(dvSem.V) || 0);
    const mSemFull = Number(metaSemFull.M) || 0;
    const mSemAte = Number(metaSemAte.M) || 0;

    let semanaStatus = 'ABAIXO';
    if (mSemFull > 0 && realSem >= mSemFull) semanaStatus = 'BATIDA';
    else if (mSemAte > 0 && realSem >= mSemAte * 0.999) semanaStatus = 'NO RITMO';

    return {
        rca, filial,
        nome: usr.NOME || `RCA ${rca}`,
        supervisor: usr.CODSUPERVISOR,
        ref, mesIni, mesFim, segunda, sexta, proxSeg, proxSex, mesTrimestre,
        mesLabel: `${MESES_PT[ref.getMonth()]}/${ref.getFullYear()}`,
        metaVenda, realizado, gap, esperadoHoje,
        pctMeta: PCT(realizado, metaVenda),
        dias: { total: totDU, decorridos: decDU, restantes: restDU, proxSemana: Number(duProx.N) || 0 },
        ritmoAtual, precisaDia, projecao,
        precisaProxSemana: precisaDia * (Number(duProx.N) || 0),
        semana: { meta: mSemFull, metaAteHoje: mSemAte, realizado: realSem, status: semanaStatus, faltaFechar: Math.max(mSemFull - realSem, 0) },
        qualitativas: [
            { nome: 'Positivação', meta: Number(metaM.POS) || 0, real: Number(pos.N) || 0 },
            { nome: 'Mix de Produtos', meta: Number(metaM.MIX) || 0, real: Number(mix.N) || 0 },
            { nome: 'Abertura (novos)', meta: Number(meta.MA) || 0, real: Number(nov.N) || 0 },
            { nome: 'Reativação', meta: Number(meta.MR) || 0, real: Number(rea.N) || 0 }
        ],
        semanasMes,
        fornecedores,
        triLabel: `${D(qIni)}–${D(qFim)}/${qFim.getFullYear()}`,
        curvaA: {
            rows: curvaARows,
            totalPrevQ,
            totalCurQ: cliCurQ.reduce((a, r) => a + (Number(r.V) || 0), 0),
            countA: curvaARows.length,
            countCli: cliPrevQ.length,
            qFrac,
            prevLabel: `${D(pqIni)}–${D(pqFim)}/${pqFim.getFullYear()}`,
            curLabel: `${D(qIni)}–${D(ref)}`
        },
        inativos
    };
}

// ===================== desenho do PDF =====================
const C = {
    royal: '#002bf0', dark: '#0f172a', slate: '#475569', muted: '#94a3b8',
    red: '#dc2626', redBg: '#fef2f2', redBd: '#fecaca',
    blue: '#2563eb', blueBg: '#eff6ff', blueBd: '#bfdbfe',
    green: '#10b981', greenD: '#059669', greenBg: '#ecfdf5', greenBd: '#a7f3d0',
    amber: '#f59e0b', amberBg: '#fffbeb', amberBd: '#fde68a',
    card: '#ffffff', line: '#cbd5e1', track: '#e2e8f0', header: '#1e293b'
};

function drawHeader(doc, subtitle) {
    const grad = doc.linearGradient(0, 0, 0, 841.89);
    grad.stop(0, '#f8f9fa').stop(1, '#edf0f2');
    doc.rect(0, 0, 595.28, 841.89).fill(grad);
    if (fs.existsSync(LOGO_PATH)) {
        try { doc.image(LOGO_PATH, 36, 25, { width: 130 }); } catch (e) { /* ignore */ }
    } else {
        doc.fillColor(C.royal).fontSize(22).font('Helvetica-Bold').text('BRAGO', 36, 30);
    }
    doc.fillColor(C.dark).fontSize(14).font('Helvetica-Bold')
        .text('ACOMPANHAMENTO SEMANAL DE METAS', 200, 30, { width: 359, align: 'right' });
    doc.fillColor(C.slate).fontSize(9).font('Helvetica').text(subtitle, 200, 48, { width: 359, align: 'right' });
    doc.strokeColor(C.royal).lineWidth(2).moveTo(36, 68).lineTo(559, 68).stroke();
}

function roundedCard(doc, x, y, w, h, bg, border) {
    doc.roundedRect(x, y, w, h, 6).fill(bg);
    if (border) doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).strokeColor(border).stroke();
}

function paceArrow(doc, x, y, up) {
    if (up) doc.polygon([x, y + 7], [x + 4, y], [x + 8, y + 7]).fill(C.green);
    else doc.polygon([x, y], [x + 4, y + 7], [x + 8, y]).fill(C.red);
}

function progressBar(doc, x, y, w, h, pct, color, marker) {
    doc.roundedRect(x, y, w, h, h / 2).fill(C.track);
    const fillW = Math.max(Math.min(pct / 100, 1) * w, pct > 0 ? h : 0);
    if (pct > 0) doc.roundedRect(x, y, fillW, h, h / 2).fill(color);
    if (marker !== undefined && marker !== null) {
        const mx = x + Math.max(Math.min(marker / 100, 1), 0) * w;
        doc.rect(mx - 1, y - 3, 2, h + 6).fill(C.dark);
    }
}

function drawSellerPages(doc, d) {
    // ============================ PÁGINA 1 ============================
    drawHeader(doc, `Semana ${D(d.segunda)} a ${D(d.sexta)}  ·  ${d.mesLabel}  ·  Mês ${d.mesTrimestre} do trimestre`);
    let y = 84;

    // --- cartão do vendedor ---
    roundedCard(doc, 36, y, 523, 54, C.card, C.line);
    doc.circle(66, y + 27, 17).fill(C.royal);
    doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
        .text(String(d.nome).trim().charAt(0).toUpperCase(), 36, y + 19, { width: 60, align: 'center' });
    doc.fillColor(C.dark).fontSize(13.5).font('Helvetica-Bold').text(d.nome, 94, y + 11);
    doc.fillColor(C.slate).fontSize(9).font('Helvetica')
        .text(`RCA ${d.rca}  ·  Filial ${d.filial}  ·  Supervisor ${d.supervisor || '—'}`, 94, y + 30);
    doc.fillColor(C.royal).fontSize(10.5).font('Helvetica-Bold')
        .text(d.mesLabel.toUpperCase(), 380, y + 13, { width: 168, align: 'right' });
    doc.fillColor(C.muted).fontSize(8).font('Helvetica')
        .text(`Emitido em ${d.ref.toLocaleDateString('pt-BR')}`, 380, y + 30, { width: 168, align: 'right' });
    y += 68;

    // --- KPIs do mês ---
    const kpiW = 166, kpiH = 58, gapX = 12.5;
    const noPace = d.ritmoAtual >= d.precisaDia;
    const kpis = [
        { t: 'META DO MÊS', v: BRL0(d.metaVenda), bg: C.blueBg, bd: C.blueBd, fg: C.blue, s: '' },
        { t: 'REALIZADO ATÉ AGORA', v: BRL0(d.realizado), bg: noPace ? C.greenBg : C.amberBg, bd: noPace ? C.greenBd : C.amberBd, fg: noPace ? C.greenD : C.amber, s: `${F1(d.pctMeta)}% da meta` },
        { t: 'FALTA PARA A META', v: BRL0(d.gap), bg: C.redBg, bd: C.redBd, fg: C.red, s: `${d.dias.restantes} dia(s) útil(eis) restantes` }
    ];
    kpis.forEach((k, i) => {
        const x = 36 + i * (kpiW + gapX);
        roundedCard(doc, x, y, kpiW, kpiH, k.bg, k.bd);
        doc.fillColor(C.slate).fontSize(7.5).font('Helvetica-Bold').text(k.t, x + 12, y + 9);
        doc.fillColor(k.fg).fontSize(15).font('Helvetica-Bold').text(k.v, x + 12, y + 22);
        if (k.s) doc.fillColor(C.slate).fontSize(7.5).font('Helvetica').text(k.s, x + 12, y + 43);
    });
    y += kpiH + 16;

    // --- barra de progresso do mês ---
    doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold').text('PROGRESSO DO MÊS', 36, y);
    const pctEsper = PCT(d.esperadoHoje, d.metaVenda);
    doc.rect(322, y + 1, 6, 6).fill(C.dark);
    doc.fillColor(C.slate).fontSize(8).font('Helvetica')
        .text(`esperado até hoje: ${F1(pctEsper)}% (${BRL0(d.esperadoHoje)})`, 333, y, { width: 226, align: 'left' });
    y += 14;
    const barColor = d.pctMeta >= pctEsper ? C.green : (d.pctMeta >= pctEsper * 0.8 ? C.amber : C.red);
    progressBar(doc, 36, y, 523, 14, d.pctMeta, barColor, pctEsper);
    doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold')
        .text(`${F1(d.pctMeta)}%`, 36, y + 20, { width: 523, align: d.pctMeta > 8 ? 'left' : 'left' });
    y += 40;

    // --- resultado da semana ---
    roundedCard(doc, 36, y, 523, 92, C.card, C.line);
    doc.rect(36, y, 4, 92).fill(C.royal);
    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold')
        .text(`SEMANA  ${D(d.segunda)} – ${D(d.sexta)}`, 52, y + 10);

    // badge de status
    const st = d.semana.status;
    const stCfg = st === 'BATIDA' ? { bg: C.greenBg, bd: C.greenBd, fg: C.greenD, txt: 'META DA SEMANA BATIDA' }
        : st === 'NO RITMO' ? { bg: C.blueBg, bd: C.blueBd, fg: C.blue, txt: 'NO RITMO DA SEMANA' }
            : { bg: C.redBg, bd: C.redBd, fg: C.red, txt: 'ABAIXO DA META DA SEMANA' };
    const bw = 190;
    roundedCard(doc, 559 - bw - 12, y + 8, bw, 20, stCfg.bg, stCfg.bd);
    doc.fillColor(stCfg.fg).fontSize(8.5).font('Helvetica-Bold')
        .text(stCfg.txt, 559 - bw - 12, y + 14, { width: bw, align: 'center' });

    doc.fillColor(C.slate).fontSize(8).font('Helvetica').text('META DA SEMANA', 52, y + 36);
    doc.fillColor(C.dark).fontSize(12.5).font('Helvetica-Bold').text(BRL0(d.semana.meta), 52, y + 47);
    doc.fillColor(C.slate).fontSize(8).font('Helvetica').text('REALIZADO NA SEMANA', 210, y + 36);
    doc.fillColor(st === 'ABAIXO' ? C.red : C.greenD).fontSize(12.5).font('Helvetica-Bold').text(BRL0(d.semana.realizado), 210, y + 47);
    doc.fillColor(C.slate).fontSize(8).font('Helvetica').text('% DA SEMANA', 380, y + 36);
    doc.fillColor(C.dark).fontSize(12.5).font('Helvetica-Bold').text(`${F1(PCT(d.semana.realizado, d.semana.meta))}%`, 380, y + 47);

    if (d.semana.faltaFechar > 0) {
        doc.fillColor(C.slate).fontSize(8.5).font('Helvetica')
            .text(`Para fechar a semana batendo a meta: vender ${BRL0(d.semana.faltaFechar)} até ${D(d.sexta)}.`, 52, y + 71, { width: 490 });
    } else {
        doc.fillColor(C.greenD).fontSize(8.5).font('Helvetica-Bold')
            .text('Meta da semana concluída — excelente resultado!', 52, y + 71, { width: 490 });
    }
    y += 106;

    // --- metas qualitativas ---
    doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold').text('METAS QUALITATIVAS DO MÊS', 36, y);
    y += 15;
    const qW = 255, qH = 62, qGap = 13;
    d.qualitativas.forEach((q, i) => {
        const x = 36 + (i % 2) * (qW + qGap);
        const yy = y + Math.floor(i / 2) * (qH + 10);
        const pct = PCT(q.real, q.meta);
        const ok = q.meta > 0 && q.real >= q.meta;
        roundedCard(doc, x, yy, qW, qH, C.card, C.line);
        doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold').text(q.nome, x + 12, yy + 9);
        doc.fillColor(ok ? C.greenD : C.slate).fontSize(9).font('Helvetica-Bold')
            .text(q.meta > 0 ? `${F1(pct)}%` : '—', x + 12, yy + 9, { width: qW - 24, align: 'right' });
        doc.fillColor(C.slate).fontSize(8).font('Helvetica')
            .text(`Meta: ${q.meta}   ·   Realizado: ${q.real}   ·   ${q.real - q.meta >= 0 ? '+' : ''}${q.real - q.meta}`, x + 12, yy + 24);
        progressBar(doc, x + 12, yy + 40, qW - 24, 9, pct, ok ? C.green : (pct >= 60 ? C.amber : C.red));
    });
    y += 2 * qH + 10 + 14;

    // --- metas por fornecedor (PCMETA TIPOMETA='F') ---
    if (d.fornecedores && d.fornecedores.length > 0) {
        doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold').text(`METAS POR FORNECEDOR — TRIMESTRE (${d.triLabel})`, 36, y);
        y += 14;
        doc.rect(36, y, 523, 15).fill(C.header);
        doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');
        doc.text('FORNECEDOR', 44, y + 4, { width: 150 });
        doc.text('META DO TRI', 200, y + 4, { width: 85, align: 'right' });
        doc.text('REALIZADO (TRI)', 290, y + 4, { width: 85, align: 'right' });
        doc.text('%', 380, y + 4, { width: 40, align: 'right' });
        doc.text('PROGRESSO', 430, y + 4, { width: 120, align: 'center' });
        y += 15;
        const fShow = d.fornecedores.slice(0, 6);
        fShow.forEach((f, i) => {
            const pct = PCT(f.real, f.meta);
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
            doc.rect(36, y, 523, 16).fill(rowBg);
            doc.fillColor(C.dark).fontSize(8).font('Helvetica-Bold').text(String(f.nome).slice(0, 28), 44, y + 4, { width: 150 });
            doc.fillColor(C.slate).font('Helvetica').text(BRL0(f.meta), 200, y + 4, { width: 85, align: 'right' });
            doc.fillColor(pct >= 100 ? C.greenD : C.dark).font('Helvetica-Bold').text(BRL0(f.real), 290, y + 4, { width: 85, align: 'right' });
            doc.fillColor(pct >= 100 ? C.greenD : (pct >= 60 ? C.amber : C.red)).text(`${F1(pct)}%`, 380, y + 4, { width: 40, align: 'right' });
            progressBar(doc, 435, y + 4.5, 110, 7, pct, pct >= 100 ? C.green : (pct >= 60 ? C.amber : C.red));
            y += 16;
        });
        if (d.fornecedores.length > 6) {
            doc.fillColor(C.muted).fontSize(7.5).font('Helvetica')
                .text(`+ ${d.fornecedores.length - 6} outro(s) fornecedor(es) com meta no mês.`, 44, y + 3);
            y += 14;
        }
    }

    // ============================ PÁGINA 2 ============================
    doc.addPage();
    drawHeader(doc, `Plano de ação  ·  ${d.nome}  ·  ${d.mesLabel}`);
    y = 84;

    doc.roundedRect(36, y, 523, 24, 4).fill(C.header);
    doc.fillColor('#ffffff').fontSize(10.5).font('Helvetica-Bold')
        .text('PLANO PARA BATER O MÊS', 36, y + 7, { width: 523, align: 'center' });
    y += 38;

    if (d.metaVenda <= 0) {
        roundedCard(doc, 36, y, 523, 60, C.amberBg, C.amberBd);
        doc.fillColor(C.amber).fontSize(10).font('Helvetica-Bold').text('Meta do mês ainda não lançada', 52, y + 14);
        doc.fillColor(C.slate).fontSize(9).font('Helvetica')
            .text('Sem meta cadastrada na PCMETARCA para este mês — plano de recuperação indisponível.', 52, y + 32, { width: 490 });
        y += 74;
    } else {
        // --- ritmo: 3 cards ---
        const rW = 166, rH = 64;
        const cards2 = [
            { t: 'DIAS ÚTEIS RESTANTES', v: String(d.dias.restantes), s: `de ${d.dias.total} no mês`, fg: C.dark, bg: C.card, bd: C.line },
            { t: 'PRECISA VENDER POR DIA', v: BRL0(d.precisaDia), s: 'para bater a meta', fg: C.blue, bg: C.blueBg, bd: C.blueBd },
            { t: 'RITMO ATUAL POR DIA', v: BRL0(d.ritmoAtual), s: noPace2(d) ? 'acima do necessário ✓' : `faltam ${BRL0(Math.max(d.precisaDia - d.ritmoAtual, 0))}/dia`, fg: noPace2(d) ? C.greenD : C.red, bg: noPace2(d) ? C.greenBg : C.redBg, bd: noPace2(d) ? C.greenBd : C.redBd }
        ];
        cards2.forEach((k, i) => {
            const x = 36 + i * (rW + gapX);
            roundedCard(doc, x, y, rW, rH, k.bg, k.bd);
            doc.fillColor(C.slate).fontSize(7.5).font('Helvetica-Bold').text(k.t, x + 12, y + 9);
            doc.fillColor(k.fg).fontSize(15).font('Helvetica-Bold').text(k.v, x + 12, y + 23);
            doc.fillColor(C.slate).fontSize(7.5).font('Helvetica').text(k.s, x + 12, y + 46);
        });
        y += rH + 14;

        // --- projeção ---
        const projPct = PCT(d.projecao, d.metaVenda);
        const projOk = projPct >= 100;
        roundedCard(doc, 36, y, 523, 52, projOk ? C.greenBg : C.redBg, projOk ? C.greenBd : C.redBd);
        doc.rect(36, y, 4, 52).fill(projOk ? C.green : C.red);
        doc.fillColor(C.slate).fontSize(8).font('Helvetica-Bold').text('PROJEÇÃO DE FECHAMENTO NO RITMO ATUAL', 52, y + 9);
        doc.fillColor(projOk ? C.greenD : C.red).fontSize(14).font('Helvetica-Bold')
            .text(`${BRL0(d.projecao)}   (${F1(projPct)}% da meta)`, 52, y + 24);
        doc.fillColor(C.slate).fontSize(8.5).font('Helvetica')
            .text(projOk ? 'Mantendo o ritmo, a meta será batida.' : 'No ritmo atual a meta NÃO será atingida — ver plano abaixo.', 320, y + 28, { width: 228, align: 'right' });
        y += 66;

        // --- próxima semana + restante do mês ---
        const half = 255;
        roundedCard(doc, 36, y, half, 78, C.card, C.line);
        doc.rect(36, y, 4, 78).fill(C.blue);
        doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold')
            .text(`PRÓXIMA SEMANA  (${D(d.proxSeg)} – ${D(d.proxSex)})`, 52, y + 10);
        doc.fillColor(C.blue).fontSize(14).font('Helvetica-Bold').text(BRL0(d.precisaProxSemana), 52, y + 27);
        doc.fillColor(C.slate).fontSize(8).font('Helvetica')
            .text(`${d.dias.proxSemana} dia(s) útil(eis) × ${BRL0(d.precisaDia)}/dia`, 52, y + 47);
        doc.fillColor(C.muted).fontSize(7.5).font('Helvetica')
            .text('Venda necessária na semana para entrar no ritmo da meta.', 52, y + 60, { width: half - 28 });

        roundedCard(doc, 36 + half + 13, y, half, 78, C.card, C.line);
        doc.rect(36 + half + 13, y, 4, 78).fill(C.red);
        doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold').text('RESTANTE DO MÊS', 52 + half + 13, y + 10);
        doc.fillColor(C.red).fontSize(14).font('Helvetica-Bold').text(BRL0(d.gap), 52 + half + 13, y + 27);
        doc.fillColor(C.slate).fontSize(8).font('Helvetica')
            .text(`em ${d.dias.restantes} dia(s) útil(eis) até ${D(d.mesFim)}`, 52 + half + 13, y + 47);
        doc.fillColor(C.muted).fontSize(7.5).font('Helvetica')
            .text('Valor total que falta para fechar o mês na meta.', 52 + half + 13, y + 60, { width: half - 28 });
        y += 92;

        // --- pontos de atenção qualitativos ---
        doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold').text('PONTOS DE ATENÇÃO — QUALITATIVAS', 36, y);
        y += 14;
        const fracao = d.dias.total > 0 ? d.dias.decorridos / d.dias.total : 0;
        const atencao = d.qualitativas.filter(q => q.meta > 0 && q.real < q.meta * fracao * 0.999 || (q.meta > 0 && q.real < q.meta && d.dias.restantes <= 5));
        if (atencao.length === 0) {
            roundedCard(doc, 36, y, 523, 30, C.greenBg, C.greenBd);
            doc.fillColor(C.greenD).fontSize(9).font('Helvetica-Bold')
                .text('Todas as metas qualitativas estão no ritmo esperado para o mês.', 52, y + 10);
            y += 44;
        } else {
            atencao.forEach(q => {
                roundedCard(doc, 36, y, 523, 26, C.amberBg, C.amberBd);
                doc.fillColor(C.amber).fontSize(8.5).font('Helvetica-Bold').text(`• ${q.nome}:`, 48, y + 8, { continued: true });
                doc.fillColor(C.slate).font('Helvetica')
                    .text(`  ${q.real} de ${q.meta} — faltam ${Math.max(q.meta - q.real, 0)} para a meta do mês.`);
                y += 32;
            });
            y += 8;
        }

        // --- gráfico: semanas do mês (meta x realizado) ---
        if (d.semanasMes.length > 0 && y < 640) {
            doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold').text('SEMANAS DO MÊS — META × REALIZADO', 36, y);
            doc.rect(452, y + 1, 6, 6).fill(C.track);
            doc.fillColor(C.muted).fontSize(7.5).font('Helvetica').text('meta', 462, y);
            doc.rect(495, y + 1, 6, 6).fill(C.royal);
            doc.fillColor(C.slate).fontSize(7.5).font('Helvetica').text('realizado', 505, y);
            // Respiro para os rótulos de valor não colidirem com o título,
            // e grupos centralizados na largura útil (sem ficar tudo espremido à esquerda).
            const chH = 84, chY = y + 30, baseY = chY + chH;
            const maxV = Math.max(...d.semanasMes.map(s => Math.max(s.meta, s.real)), 1);
            const nSem = d.semanasMes.length;
            const groupW = Math.min(130, Math.floor(523 / nSem));
            const startX = 36 + Math.max((523 - nSem * groupW) / 2, 0);
            const barW = Math.max(Math.min(34, (groupW - 26) / 2), 12);
            d.semanasMes.forEach((s, i) => {
                const gx = startX + i * groupW + (groupW - (2 * barW + 6)) / 2;
                const hM = Math.max((s.meta / maxV) * chH, 2);
                const hR = Math.max((s.real / maxV) * chH, 2);
                doc.rect(gx, baseY - hM, barW, hM).fill(C.track);
                doc.rect(gx + barW + 6, baseY - hR, barW, hR).fill(s.real >= s.meta ? C.green : C.royal);
                // rótulos: se as alturas forem próximas, empilha para não sobrepor
                const metaLblY = baseY - hM - 11;
                let realLblY = baseY - hR - 11;
                if (Math.abs(metaLblY - realLblY) < 9) realLblY = metaLblY - 10;
                doc.fillColor(C.slate).fontSize(7).font('Helvetica')
                    .text(BRL0(s.meta), gx - 20, metaLblY, { width: barW + 34, align: 'center' });
                doc.fillColor(C.dark).fontSize(7).font('Helvetica-Bold')
                    .text(BRL0(s.real), gx + barW - 8, realLblY, { width: barW + 34, align: 'center' });
                doc.fillColor(C.slate).fontSize(7.5).font('Helvetica')
                    .text(`sem. ${D(s.w)}`, gx - 20, baseY + 6, { width: 2 * barW + 46, align: 'center' });
            });
            doc.strokeColor(C.line).lineWidth(0.7).moveTo(36, baseY).lineTo(559, baseY).stroke();
        }
    }

    // Nota do trimestre
    doc.fillColor(C.muted).fontSize(7.5).font('Helvetica')
        .text(d.mesTrimestre === 3
            ? 'Mês de fechamento do trimestre: metas trimestrais de fornecedor entram nesta edição.'
            : `Mês ${d.mesTrimestre} do trimestre — acompanhamento com abrangência do mês corrente. Metas trimestrais de fornecedor são avaliadas no 3º mês.`,
            36, 772, { width: 523, align: 'center' });

    // ============================ PÁGINA 3 — INTELIGÊNCIA COMERCIAL ============================
    doc.addPage();
    drawHeader(doc, `Inteligência Comercial  ·  ${d.nome}  ·  ${d.mesLabel}`);
    y = 84;

    doc.roundedRect(36, y, 523, 24, 4).fill(C.header);
    doc.fillColor('#ffffff').fontSize(10.5).font('Helvetica-Bold')
        .text('INTELIGÊNCIA COMERCIAL — CARTEIRA DE CLIENTES', 36, y + 7, { width: 523, align: 'center' });
    y += 36;

    // --- chips de resumo ---
    const laranja = '#ea580c', laranjaBg = '#fff7ed', laranjaBd = '#fed7aa';
    const chips = [
        { t: 'CURVA A (80/20)', v: `${d.curvaA.countA}`, s: `de ${d.curvaA.countCli} clientes`, bg: C.blueBg, bd: C.blueBd, fg: C.blue },
        { t: 'SEM COMPRA 30–60d', v: `${d.inativos.f3060.length}`, s: 'reativar já', bg: C.amberBg, bd: C.amberBd, fg: C.amber },
        { t: 'SEM COMPRA 60–90d', v: `${d.inativos.f6090.length}`, s: 'em risco', bg: laranjaBg, bd: laranjaBd, fg: laranja },
        { t: 'SEM COMPRA +90d', v: `${d.inativos.f90.length}`, s: 'recuperar', bg: C.redBg, bd: C.redBd, fg: C.red }
    ];
    const chipW = 122.75, chipGap = 10.6;
    chips.forEach((k, i) => {
        const x = 36 + i * (chipW + chipGap);
        roundedCard(doc, x, y, chipW, 46, k.bg, k.bd);
        doc.fillColor(C.slate).fontSize(6.8).font('Helvetica-Bold').text(k.t, x + 9, y + 7);
        doc.fillColor(k.fg).fontSize(15).font('Helvetica-Bold').text(k.v, x + 9, y + 17);
        doc.fillColor(C.slate).fontSize(6.8).font('Helvetica').text(k.s, x + 9, y + 35);
    });
    y += 60;

    // --- tabela curva A ---
    doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold')
        .text(`CLIENTES CURVA A (80/20) — TRI ANTERIOR (${d.curvaA.prevLabel}) × TRI ATUAL`, 36, y);
    paceArrow(doc, 445, y + 1, true);
    doc.fillColor(C.slate).fontSize(6.8).font('Helvetica').text('no ritmo', 456, y + 1);
    paceArrow(doc, 495, y + 1, false);
    doc.fillColor(C.slate).fontSize(6.8).font('Helvetica').text('abaixo', 506, y + 1);
    y += 14;
    doc.rect(36, y, 523, 14).fill(C.header);
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
    doc.text('CÓD', 42, y + 4, { width: 40 });
    doc.text('CLIENTE', 86, y + 4, { width: 168 });
    doc.text('FAT. TRI ANT.', 258, y + 4, { width: 75, align: 'right' });
    doc.text('FAT. ATUAL', 338, y + 4, { width: 70, align: 'right' });
    doc.text('PART.', 413, y + 4, { width: 38, align: 'right' });
    doc.text('RITMO P/ SUPERAR', 456, y + 4, { width: 98, align: 'right' });
    y += 14;
    const aShow = d.curvaA.rows.slice(0, 15);
    aShow.forEach((r, i) => {
        const rowBg = r.inativoDias ? C.amberBg : (i % 2 === 0 ? '#ffffff' : '#f8fafc');
        doc.rect(36, y, 523, 14).fill(rowBg);
        doc.fillColor(C.slate).fontSize(7.5).font('Helvetica').text(String(r.cod), 42, y + 3.5, { width: 40 });
        const nomeTxt = String(r.nome).slice(0, 30) + (r.inativoDias ? `  (${r.inativoDias}d s/ compra)` : '');
        doc.fillColor(r.inativoDias ? C.amber : C.dark).font(r.inativoDias ? 'Helvetica-Bold' : 'Helvetica')
            .text(nomeTxt, 86, y + 3.5, { width: 168, ellipsis: true, height: 9 });
        doc.fillColor(C.slate).font('Helvetica').text(BRL0(r.q2), 258, y + 3.5, { width: 75, align: 'right' });
        doc.fillColor(r.atual > 0 ? C.dark : C.muted).font('Helvetica-Bold')
            .text(r.atual > 0 ? BRL0(r.atual) : '—', 338, y + 3.5, { width: 70, align: 'right' });
        doc.fillColor(C.slate).font('Helvetica').text(`${F1(r.part)}%`, 413, y + 3.5, { width: 38, align: 'right' });
        paceArrow(doc, 508, y + 3.5, r.ok);
        doc.fillColor(r.ok ? C.greenD : C.red).fontSize(7).font('Helvetica-Bold')
            .text(`${F1(PCT(r.atual, r.q2))}%`, 456, y + 4, { width: 48, align: 'right' });
        y += 14;
    });
    if (d.curvaA.rows.length > 15) {
        doc.fillColor(C.muted).fontSize(7).font('Helvetica')
            .text(`+ ${d.curvaA.rows.length - 15} outro(s) cliente(s) curva A.`, 42, y + 2);
        y += 12;
    }
    const aInativos = d.curvaA.rows.filter(r => r.inativoDias);
    if (aInativos.length > 0) {
        doc.fillColor(C.amber).fontSize(7.5).font('Helvetica-Bold')
            .text(`ATENÇÃO: ${aInativos.length} cliente(s) da Curva A sem compra há 30+ dias — prioridade máxima de contato.`, 42, y + 3);
        y += 15;
    }
    y += 8;

    // --- clientes sem compra por faixa ---
    doc.fillColor(C.dark).fontSize(9.5).font('Helvetica-Bold').text('CLIENTES SEM COMPRA — PRIORIZE O RETORNO', 36, y);
    y += 14;
    // Lista COMPLETA (sem esconder cliente nenhum): quebra automaticamente para a
    // página seguinte quando a seção/linha não couber, repetindo o cabeçalho da seção.
    const intelSubtitle = `Inteligência Comercial  ·  ${d.nome}  ·  ${d.mesLabel}`;
    const secoes = [
        { titulo: '30 A 60 DIAS SEM COMPRA', lista: d.inativos.f3060, bg: C.amberBg, fg: C.amber, bd: C.amberBd },
        { titulo: '60 A 90 DIAS SEM COMPRA', lista: d.inativos.f6090, bg: laranjaBg, fg: laranja, bd: laranjaBd },
        { titulo: 'MAIS DE 90 DIAS SEM COMPRA', lista: d.inativos.f90, bg: C.redBg, fg: C.red, bd: C.redBd }
    ];
    const drawSecHeader = (sec, cont) => {
        const totV = sec.lista.reduce((a, r) => a + r.v12m, 0);
        roundedCard(doc, 36, y, 523, 16, sec.bg, sec.bd);
        doc.fillColor(sec.fg).fontSize(8).font('Helvetica-Bold')
            .text(`${sec.titulo}${cont ? ' (CONTINUAÇÃO)' : ''}  —  ${sec.lista.length} cliente(s)  ·  ${BRL0(totV)} comprados em 12 meses`, 44, y + 4.5);
        y += 19;
    };
    secoes.forEach(sec => {
        // se o cabeçalho da seção + 1 linha não couberem, quebra a página antes
        if (y > 752) { doc.addPage(); drawHeader(doc, intelSubtitle); y = 84; }
        drawSecHeader(sec, false);
        sec.lista.forEach((r, i) => {
            if (y > 782) { // sem espaço para a próxima linha: nova página + cabeçalho de continuação
                doc.addPage(); drawHeader(doc, intelSubtitle); y = 84;
                drawSecHeader(sec, true);
            }
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
            doc.rect(36, y, 523, 13).fill(rowBg);
            doc.fillColor(C.slate).fontSize(7.5).font('Helvetica').text(String(r.cod), 42, y + 3, { width: 42 });
            doc.fillColor(C.dark).text(String(r.nome).slice(0, 40), 88, y + 3, { width: 240, ellipsis: true, height: 9 });
            doc.fillColor(sec.fg).font('Helvetica-Bold').text(`${r.dias} dias`, 335, y + 3, { width: 60, align: 'right' });
            doc.fillColor(C.slate).font('Helvetica').text(`12m: ${BRL0(r.v12m)}`, 405, y + 3, { width: 148, align: 'right' });
            y += 13;
        });
        y += 6;
    });
}

function noPace2(d) { return d.ritmoAtual >= d.precisaDia; }
const gapX = 12.5;

async function generateWeeklyGoalsPdf(sellersData, dryRun = false, outPath = null) {
    return new Promise((resolve, reject) => {
        try {
            const pdfPath = outPath || (dryRun ? PDF_DRYRUN_PATH : PDF_PATH);
            const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
            const stream = fs.createWriteStream(pdfPath);
            doc.pipe(stream);

            sellersData.forEach((d, i) => {
                if (i > 0) doc.addPage();
                drawSellerPages(doc, d);
            });

            // rodapé com paginação
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                const old = doc.page.margins.bottom; doc.page.margins.bottom = 0;
                doc.strokeColor(C.line).lineWidth(0.5).moveTo(36, 800).lineTo(559, 800).stroke();
                doc.fillColor(C.slate).fontSize(8.5).font('Helvetica')
                    .text('Acompanhamento Semanal de Metas — Brago App System', 36, 808);
                doc.text(`Página ${i + 1} de ${range.count}`, 450, 808, { align: 'right', width: 109 });
                doc.page.margins.bottom = old;
            }
            doc.end();
            stream.on('finish', () => resolve(pdfPath));
            stream.on('error', reject);
        } catch (err) { reject(err); }
    });
}

// ===================== orquestração =====================
// testRcas (array de códigos) permite gerar relatórios de RCAs específicos — útil
// para mandar amostras de teste (ex.: 3 vendedores) para um número, cada um no seu
// próprio PDF. A filial de cada RCA é buscada na PCUSUARI.
async function runWeeklyGoalsReport(dryRun = false, testPhone = null, refDate = null, testRcas = null) {
    logger.info(`📈 Iniciando relatório semanal de metas${dryRun ? ' (DRY-RUN)' : ''}${testPhone ? ` (TESTE → ${testPhone})` : ''}${testRcas ? ` [RCAs ${testRcas.join(',')}]` : ''}...`);
    const ref = refDate ? parseLocalDate(refDate) : new Date();
    ref.setHours(0, 0, 0, 0);

    let connection;
    const sellersData = [];
    try {
        connection = await getConnection();
        let sellersList = SELLERS;
        if (Array.isArray(testRcas) && testRcas.length > 0) {
            // Resolve a filial de cada RCA solicitado
            sellersList = [];
            for (const rca of testRcas) {
                const r = await connection.execute(
                    `SELECT CODFILIAL FROM PCUSUARI WHERE CODUSUR=:c`,
                    { c: rca }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                const fil = r.rows[0] ? String(r.rows[0].CODFILIAL).trim() : '20';
                sellersList.push({ rca: Number(rca), filial: fil });
            }
        }
        for (const s of sellersList) {
            sellersData.push(await gatherSellerData(connection, s.rca, s.filial, ref));
        }
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { /* ignore */ } }
    }

    // Amostra de teste: um PDF por vendedor, todos para o testPhone.
    if (testPhone && Array.isArray(testRcas) && testRcas.length > 0) {
        let sent = 0;
        for (const d of sellersData) {
            const outPath = path.join(__dirname, '..', '..', 'data', `metas_teste_rca_${d.rca}.pdf`);
            await generateWeeklyGoalsPdf([d], false, outPath);
            if (dryRun) { logger.info(`[MetasTeste] (dry) PDF ok: ${d.rca} ${d.nome}`); continue; }
            const caption = `🧪 *[TESTE] Acompanhamento Semanal de Metas — ${d.nome}*\n` +
                `🗓️ Semana ${D(d.segunda)} a ${D(d.sexta)} · ${d.mesLabel}\n` +
                `Mês: ${F1(d.pctMeta)}% da meta · Realizado: ${BRL0(d.realizado)} · Semana: ${d.semana.status}`;
            const ok = await whatsapp.sendFileToNumber(testPhone, outPath, caption, { type: 'weekly_goals_test', rca: d.rca });
            if (ok) sent++;
            await new Promise(r => setTimeout(r, 2500));
        }
        logger.info(`📈 Relatório de metas (TESTE): ${sent}/${sellersData.length} enviado(s) → ${testPhone}.`);
        return { success: true, dryRun, test: true, sentCount: sent, target: testPhone, sellers: sellersData.map(d => d.nome) };
    }

    const pdfPath = await generateWeeklyGoalsPdf(sellersData, dryRun);
    logger.info(`✅ PDF de metas semanal gerado: ${pdfPath}`);

    if (dryRun) {
        return { success: true, dryRun: true, pdfPath, sellers: sellersData.map(d => d.nome) };
    }

    const targets = testPhone ? [testPhone] : NOTIFY_NUMBERS;
    let sentCount = 0;
    for (const d of sellersData) {
        const caption = `📈 *Acompanhamento Semanal de Metas — ${d.nome}*\n` +
            `🗓️ Semana ${D(d.segunda)} a ${D(d.sexta)} · ${d.mesLabel} (mês ${d.mesTrimestre} do trimestre)\n\n` +
            `Mês: ${F1(d.pctMeta)}% da meta · Semana: ${d.semana.status}\n` +
            `No PDF: metas por fornecedor, plano de recuperação e inteligência comercial (curva A 80/20 + clientes sem compra).`;
        for (const number of targets) {
            const ok = await whatsapp.sendFileToNumber(number, pdfPath, caption, { type: 'weekly_goals_pdf', rca: d.rca });
            if (ok) sentCount++;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    logger.info(`📈 Relatório semanal de metas: ${sentCount} envio(s) concluído(s).`);
    return { success: true, dryRun: false, pdfPath, sentCount, targets, sellers: sellersData.map(d => d.nome) };
}

// ===================== envio em massa para os vendedores =====================
// Cada vendedor ativo com meta no mês recebe o PRÓPRIO relatório no seu WhatsApp.
// Supervisores NÃO recebem o envio individual (exclusão por RCA e por telefone —
// há vendedor com telefone de supervisor no cadastro, ex.: RCA 86 com o fone da Keyla).
const EXCLUDE_RCAS = [78, 89, 105, 1075, 1100, 1101]; // Keyla, Eliane, Edson, Ozeas, Poliani, Leandro
const EXCLUDE_PHONES = ['5561999981793', '5561981587065', '5561999980000', '5562998684351', '5562998684171', '5562999331394'];

function normPhone(p) {
    let s = String(p || '').replace(/\D/g, '');
    if (s.length === 10 || s.length === 11) s = '55' + s;
    return s.length >= 12 ? s : '';
}

let massRunning = false;

async function runMassGoalsSend(dryRun = false, refDate = null) {
    if (massRunning) {
        logger.warn('[MetasMassa] Envio em massa já em andamento — ignorando novo disparo.');
        return { success: false, message: 'Envio em massa já em andamento.' };
    }
    massRunning = true;
    const resumo = { total: 0, enviados: 0, falhas: [], pulados: [] };
    try {
        const ref = refDate ? parseLocalDate(refDate) : new Date(); ref.setHours(0, 0, 0, 0);

        // Roster: vendedores ativos com meta de venda lançada no mês corrente
        let roster = [];
        const conn0 = await getConnection();
        try {
            const r = await conn0.execute(
                `SELECT U.CODUSUR, U.NOME, U.CODFILIAL, U.PSA_TELWHATS, U.TELEFONE1
                 FROM PCUSUARI U
                 WHERE U.BLOQUEIO='N' AND U.CODUSUR NOT IN (100,400,401,402,403)
                   AND EXISTS (SELECT 1 FROM PCMETARCA M WHERE M.CODUSUR=U.CODUSUR
                                 AND M.DATA BETWEEN TRUNC(SYSDATE,'MM') AND LAST_DAY(SYSDATE)
                                 AND NVL(M.VLVENDAPREV,0) > 0)
                 ORDER BY U.CODFILIAL, U.NOME`,
                [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            roster = r.rows;
        } finally { try { await conn0.close(); } catch (e) { /* ignore */ } }

        logger.info(`[MetasMassa] 🚀 Iniciando${dryRun ? ' (DRY-RUN)' : ''}: ${roster.length} vendedor(es) no roster.`);

        for (const s of roster) {
            const rcaNum = Number(s.CODUSUR);
            const nome = String(s.NOME || '').trim();
            if (EXCLUDE_RCAS.includes(rcaNum)) { resumo.pulados.push(`${rcaNum} ${nome} (supervisor)`); continue; }
            const phone = normPhone(s.PSA_TELWHATS) || normPhone(s.TELEFONE1);
            if (!phone) { resumo.pulados.push(`${rcaNum} ${nome} (sem telefone)`); continue; }
            if (EXCLUDE_PHONES.includes(phone)) { resumo.pulados.push(`${rcaNum} ${nome} (telefone de supervisor no cadastro)`); continue; }

            resumo.total++;
            try {
                const conn = await getConnection();
                let d;
                try { d = await gatherSellerData(conn, rcaNum, String(s.CODFILIAL).trim(), new Date(ref)); }
                finally { try { await conn.close(); } catch (e) { /* ignore */ } }

                const outPath = path.join(__dirname, '..', '..', 'data', `metas_semanal_rca_${rcaNum}.pdf`);
                await generateWeeklyGoalsPdf([d], false, outPath);

                if (dryRun) { logger.info(`[MetasMassa] (dry) PDF ok: ${rcaNum} ${d.nome}`); continue; }

                const primeiroNome = d.nome.split(' ')[0];
                const caption = `📈 *Acompanhamento Semanal de Metas*\n` +
                    `Olá, ${primeiroNome}! Segue o seu resumo da semana ${D(d.segunda)} a ${D(d.sexta)}:\n\n` +
                    `💰 Mês: *${F1(d.pctMeta)}%* da meta · Semana: *${d.semana.status}*\n` +
                    `No PDF: suas metas por fornecedor, plano para bater o mês e a análise da sua carteira de clientes. Bora pra cima! 💪`;

                const ok = await whatsapp.sendFileToNumber(phone, outPath, caption, { type: 'weekly_goals_seller', rca: rcaNum });
                if (ok) {
                    resumo.enviados++;
                    logger.info(`[MetasMassa] ✅ ${rcaNum} ${d.nome} → ${phone} (${resumo.enviados} enviados)`);
                } else {
                    resumo.falhas.push(`${rcaNum} ${nome}`);
                    logger.warn(`[MetasMassa] ❌ Falha no envio: ${rcaNum} ${nome} → ${phone}`);
                }
                // Anti-bloqueio (API não-oficial): 20–60s aleatórios entre envios, padrão do projeto
                const delay = Math.floor(Math.random() * (60000 - 20000 + 1)) + 20000;
                await new Promise(res => setTimeout(res, delay));
            } catch (e) {
                resumo.falhas.push(`${rcaNum} ${nome}: ${e.message}`);
                logger.error(`[MetasMassa] Erro no RCA ${rcaNum} (${nome}): ${e.message}`);
            }
        }

        logger.info(`[MetasMassa] 🏁 CONCLUÍDO: ${resumo.enviados}/${resumo.total} enviados · ${resumo.falhas.length} falha(s) · ${resumo.pulados.length} pulado(s) [${resumo.pulados.join('; ')}]`);
        return { success: true, dryRun, ...resumo };
    } finally {
        massRunning = false;
    }
}

function initScheduler() {
    if (cronJob) { cronJob.stop(); logger.info('⏹️ Cron anterior de metas semanais finalizado.'); }
    logger.info(`⏰ Agendando relatório semanal de metas (cron: "${CRON_TIME}")`);
    try {
        cronJob = new CronJob(CRON_TIME, async () => {
            try { await runWeeklyGoalsReport(false); }
            catch (err) { logger.error(`❌ Falha no relatório semanal de metas: ${err.message}`); }
        }, null, true, 'America/Sao_Paulo');
        cronJob.start();
        logger.info('🚀 Cron do relatório semanal de metas inicializado.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron de metas semanais: ${e.message}`);
    }

    // Envio em massa (cada vendedor recebe o próprio relatório) — sexta 17:00.
    // Roda no fim da sexta: a semana corrente já está completa, então ref = hoje
    // (sexta) traz a semana cheia sem zerar.
    if (massCronJob) { massCronJob.stop(); logger.info('⏹️ Cron anterior de metas em massa finalizado.'); }
    logger.info(`⏰ Agendando envio em massa de metas p/ vendedores (cron: "${MASS_CRON_TIME}")`);
    try {
        massCronJob = new CronJob(MASS_CRON_TIME, async () => {
            try { await runMassGoalsSend(false); }
            catch (err) { logger.error(`❌ Falha no envio em massa de metas: ${err.message}`); }
        }, null, true, 'America/Sao_Paulo');
        massCronJob.start();
        logger.info('🚀 Cron do envio em massa de metas inicializado.');
    } catch (e) {
        logger.error(`❌ Erro ao criar cron do envio em massa de metas: ${e.message}`);
    }
}

module.exports = { runWeeklyGoalsReport, runMassGoalsSend, generateWeeklyGoalsPdf, initScheduler, gatherSellerData };
