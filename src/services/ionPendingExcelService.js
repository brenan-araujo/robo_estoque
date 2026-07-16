const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const EXCEL_PATH = path.join(__dirname, '..', '..', 'data', 'prods_pend_cad.xlsx');

// Colunas na ordem pedida: produto some das repetições (merge vertical);
// Filial / Problema / Estoque / Trib. variam por linha dentro do produto.
const COLS = [
    { key: 'CODFORNEC',  header: 'Cód Forn.',      width: 11, merge: true,  align: 'center' },
    { key: 'FORNECEDOR', header: 'Fornecedor',     width: 30, merge: true,  align: 'left'   },
    { key: 'CODFILIAL',  header: 'Filial',         width: 8,  merge: false, align: 'center' },
    { key: 'REGIAO',     header: 'Região',         width: 32, merge: false, align: 'left'   },
    { key: 'CODPROD',    header: 'Cód Prod.',      width: 11, merge: true,  align: 'center' },
    { key: 'DESCRICAO',  header: 'Descrição',      width: 42, merge: true,  align: 'left'   },
    { key: 'PROBLEMA',   header: 'Problema',       width: 40, merge: false, align: 'left'   },
    { key: 'NCM',        header: 'NCM',            width: 12, merge: true,  align: 'center' },
    { key: 'ESTOQUE',    header: 'Estoque',        width: 10, merge: false, align: 'right'  },
    { key: 'COD_TRIB',   header: 'Cód Trib.',      width: 10, merge: false, align: 'center' },
    { key: 'MSG_TRIB',   header: 'Msg Tributação', width: 34, merge: false, align: 'left'   },
];

const THIN = { style: 'thin', color: { argb: 'CBD5E1' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * Gera a planilha de produtos pendentes de integração (ION) com merge vertical
 * por produto. `rows` deve vir ordenado por FORNECEDOR, CODPROD, CODFILIAL.
 * @param {Array<Object>} rows Linhas cruas do Oracle
 * @param {string} [outPath] Caminho de saída (default data/produtos_pendentes_ion.xlsx)
 * @returns {Promise<string>} Caminho do arquivo gerado
 */
async function generateIonPendingExcel(rows, outPath = EXCEL_PATH) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Brago App System';
    wb.created = new Date();
    const ws = wb.addWorksheet('Produtos Pendentes', { views: [{ state: 'frozen', ySplit: 2 }] });

    ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

    // ── Linha 1: título ──────────────────────────────────────────────
    const lastColLetter = String.fromCharCode(64 + COLS.length); // J
    ws.mergeCells(`A1:${lastColLetter}1`);
    const titleCell = ws.getCell('A1');
    const dataStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    titleCell.value = `PRODUTOS COM ESTOQUE PENDENTES DE INTEGRAÇÃO (ION) — ${dataStr}`;
    titleCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 28;

    // ── Linha 2: cabeçalho das colunas ───────────────────────────────
    const headerRow = ws.getRow(2);
    COLS.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = c.header;
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = BORDER;
    });
    headerRow.height = 22;

    // ── Dados: agrupa por CODPROD (mantendo a ordem recebida) ─────────
    const groups = [];
    let cur = null;
    for (const r of rows) {
        if (!cur || cur.codprod !== r.CODPROD) {
            cur = { codprod: r.CODPROD, items: [] };
            groups.push(cur);
        }
        cur.items.push(r);
    }

    let rowIdx = 3; // primeira linha de dados
    groups.forEach((g, gi) => {
        const start = rowIdx;
        const bg = gi % 2 === 0 ? 'FFFFFF' : 'F1F5F9';

        g.items.forEach(item => {
            const row = ws.getRow(rowIdx);
            COLS.forEach((c, ci) => {
                const cell = row.getCell(ci + 1);
                let val = item[c.key];
                if (c.key === 'REGIAO') val = `${item.REGIAO}${item.REGIAO_NOME ? ' · ' + item.REGIAO_NOME : ''}`;
                if (c.key === 'PROBLEMA' && (val === null || val === undefined || val === '')) val = '—';
                cell.value = (val === null || val === undefined) ? '' : val;
                cell.border = BORDER;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: c.key === 'PROBLEMA' || c.key === 'MSG_TRIB' };
                cell.font = { name: 'Calibri', size: 9.5,
                    bold: c.key === 'PROBLEMA',
                    color: { argb: c.key === 'PROBLEMA' ? 'B91C1C' : '1E293B' } };
                if (c.key === 'ESTOQUE') cell.numFmt = '#,##0.##';
                if (c.key === 'CODFILIAL') cell.value = Number(val);
            });
            row.height = 18;
            rowIdx++;
        });

        const end = rowIdx - 1;
        if (end > start) {
            // Merge vertical dos campos de nível produto
            COLS.forEach((c, ci) => {
                if (!c.merge) return;
                const col = ci + 1;
                ws.mergeCells(start, col, end, col);
                const top = ws.getCell(start, col);
                top.alignment = { vertical: 'middle', horizontal: c.align, wrapText: c.key === 'DESCRICAO' };
            });
        }
    });

    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLS.length } };

    await wb.xlsx.writeFile(outPath);
    logger.info(`✅ Planilha ION pendentes gerada: ${outPath} (${rows.length} linhas / ${groups.length} produtos)`);
    return outPath;
}

module.exports = { generateIonPendingExcel };
