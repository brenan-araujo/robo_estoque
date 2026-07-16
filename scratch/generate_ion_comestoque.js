require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const { generateIonPendingExcel } = require('../src/services/ionPendingExcelService');

async function main() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'produtos_pendentes_ion_comestoque.sql'), 'utf8').replace(/;\s*$/, '');

    await db.initialize();
    let conn;
    try {
        conn = await db.getConnection();
        const result = await conn.execute(sql, [], { outFormat: db.oracledb.OUT_FORMAT_OBJECT });
        const rows = result.rows || [];
        console.log(`Linhas retornadas: ${rows.length}`);
        const produtos = new Set(rows.map(r => r.CODPROD));
        console.log(`Produtos distintos: ${produtos.size}`);
        console.log(`Fornecedores distintos: ${new Set(rows.map(r => r.FORNECEDOR)).size}`);

        const outPath = await generateIonPendingExcel(rows);
        console.log(`\nArquivo: ${outPath}`);
        console.log(`Tamanho: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

        // Amostra de um produto com múltiplas filiais (para conferir o merge)
        const byProd = {};
        rows.forEach(r => { (byProd[r.CODPROD] = byProd[r.CODPROD] || []).push(r); });
        const multi = Object.values(byProd).find(a => a.length > 1);
        if (multi) {
            console.log(`\nExemplo produto multi-filial (${multi.length} filiais):`);
            multi.forEach(r => console.log(`  Filial ${r.CODFILIAL} | Est ${r.ESTOQUE} | ${r.PROBLEMA}`));
        } else {
            console.log('\n(Nenhum produto aparece em mais de uma filial neste recorte.)');
        }
    } finally {
        if (conn) { try { await conn.close(); } catch (e) {} }
        await db.close();
    }
}

main().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
