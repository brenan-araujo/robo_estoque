require('dotenv').config();
const database = require('../src/config/database');
const svc = require('../src/services/purchasingOracleService');
const excel = require('../src/services/purchasingExcelService');
const ExcelJS = require('exceljs');
(async()=>{
  await database.initialize();
  try {
    const rows = await svc.getPurchasingCoverageData({ janelaGiro:90, minDiasComVenda:5 });
    console.log('Total:', rows.length);
    // checa as duas vendas em uma família e um standalone
    const fam = rows.find(x=>Number(x.CODPROD)===16799 && String(x.CODFILIAL)==='21');
    const std = rows.find(x=>Number(x.CODPROD)===17016);
    if(fam) console.log(`FAMÍLIA 16799/21: peso=${Number(fam.VENDA_DIA).toFixed(3)} | 90dias=${Number(fam.VENDA_DIA_90).toFixed(3)}`);
    if(std) console.log(`STANDALONE 17016/${std.CODFILIAL}: peso=${Number(std.VENDA_DIA).toFixed(3)} | 90dias=${Number(std.VENDA_DIA_90).toFixed(3)}`);

    const path = await excel.generatePurchasingExcel(rows, true); // dry-run
    console.log('Excel gerado:', path);
    // relê o cabeçalho e uma linha de dados da aba "Detalhamento"/primeira aba de itens
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
    wb.eachSheet(ws=>{
      const hdr = ws.getRow(1).values.filter(v=>v!=null);
      if (hdr.includes('Venda Diária Peso') || hdr.includes('Venda Diária 90 dias')) {
        console.log(`\nAba "${ws.name}" cabeçalho:`);
        console.log('  '+hdr.join(' | '));
        // primeira linha de dados
        const r2 = ws.getRow(2).values.filter((v,i)=>i>0);
        console.log('  linha2:', r2.map(v=>v instanceof Date?v.toISOString().slice(0,10):v).join(' | '));
      }
    });
  } catch(e){ console.error('ERRO', e.message); console.error(e.stack); }
  finally { await database.close(); }
})();
