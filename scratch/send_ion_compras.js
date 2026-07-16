const http = require('http');
const fs = require('fs');
const path = require('path');

// Brenan Marketing (envio inicial de validação)
const RECIPIENT = '5562996101684';

function postJson(pathName, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = http.request({
            hostname: 'localhost', port: 3001, path: pathName, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let b = ''; res.on('data', c => b += c);
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, raw: b }); } });
        });
        req.on('error', reject); req.write(data); req.end();
    });
}

function br(n) { return Number(n).toLocaleString('pt-BR'); }

async function main() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'produtos_pendentes_ion.sql'), 'utf8').replace(/;\s*$/, '');

    // 1) Totais reais para a legenda
    const countSql = `SELECT COUNT(*) AS TOTAL,
        SUM(CASE WHEN "Situação Estoque" = 'COM ESTOQUE' THEN 1 ELSE 0 END) AS COM_ESTOQUE,
        COUNT(DISTINCT "Fornecedor") AS FORNECEDORES
        FROM ( ${sql} )`;
    const totals = await postJson('/api/campaigns/test-query', { selectQuery: countSql });
    if (!totals.body || !totals.body.rows) { console.error('Falha ao obter totais:', JSON.stringify(totals)); return; }
    const t = totals.body.rows[0];
    const dataStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const caption =
        `📋 *Produtos Pendentes de Integração (ION) — Revisão de Cadastro*\n` +
        `🗓️ ${dataStr}\n\n` +
        `Segue a planilha com os produtos que estão *bloqueados para venda* nas filiais 6/20, 21, 22 e 23 por pendência de cadastro.\n\n` +
        `📊 *Resumo*\n` +
        `• Itens a revisar: *${br(t.TOTAL)}*\n` +
        `• Com estoque parado (prioridade): *${br(t.COM_ESTOQUE)}*\n` +
        `• Fornecedores envolvidos: *${br(t.FORNECEDORES)}*\n\n` +
        `📌 A coluna *"O Que Resolver"* mostra exatamente o que falta em cada item (preço, custo, tributação, flag de força de venda, etc.).\n` +
        `Os itens *COM ESTOQUE* vêm no topo — é mercadoria parada que não pode ser vendida.\n\n` +
        `_Envio inicial de validação._`;

    console.log('Legenda:\n' + caption + '\n');
    console.log(`Enviando para ${RECIPIENT}...`);

    // 2) Gera Excel e envia via WhatsApp (endpoint do servidor em execução)
    const res = await postJson('/api/campaigns/send-custom-excel', {
        selectQuery: sql,
        recipients: [RECIPIENT],
        caption
    });
    console.log('HTTP', res.status);
    console.log('Resposta:', JSON.stringify(res.body || res.raw, null, 2));
}

main().catch(e => console.error('FALHA:', e.message));
