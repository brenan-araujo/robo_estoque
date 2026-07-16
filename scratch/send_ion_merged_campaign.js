const http = require('http');
const fs = require('fs');
const path = require('path');

const RECIPIENT = '5561999616441'; // Bianca Melo (envio de hoje, confirmado pelo usuário)
const XLSX_PATH = path.join(__dirname, '..', 'data', 'prods_pend_cad.xlsx');

function req(method, pathName, payload) {
    return new Promise((resolve, reject) => {
        const data = payload ? JSON.stringify(payload) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const r = http.request({ hostname: 'localhost', port: 3001, path: pathName, method, headers }, (res) => {
            let b = ''; res.on('data', c => b += c);
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, raw: b }); } });
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}
function br(n) { return Number(n).toLocaleString('pt-BR'); }

async function main() {
    // 1) Totais para a legenda
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'produtos_pendentes_ion_comestoque.sql'), 'utf8').replace(/;\s*$/, '');
    const countSql = `SELECT COUNT(*) AS OCORRENCIAS, COUNT(DISTINCT "CODPROD") AS PRODUTOS, COUNT(DISTINCT "FORNECEDOR") AS FORNECEDORES FROM ( ${sql} )`;
    const totals = await req('POST', '/api/campaigns/test-query', { selectQuery: countSql });
    const t = (totals.body && totals.body.rows && totals.body.rows[0]) || {};
    const dataStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const caption =
        `📋 *Produtos com Estoque Pendentes de Integração (ION)*\n` +
        `🗓️ ${dataStr}\n\n` +
        `Produtos *com estoque parado* mas *bloqueados para venda* por pendência de cadastro (filiais 6/20, 21, 22, 23).\n\n` +
        `📊 *Resumo*\n` +
        `• Produtos: *${br(t.PRODUTOS)}*\n` +
        `• Ocorrências (produto×filial): *${br(t.OCORRENCIAS)}*\n` +
        `• Fornecedores: *${br(t.FORNECEDORES)}*\n\n` +
        `📌 Planilha *mesclada por produto*: cada produto aparece uma vez, com uma linha por *filial/região* mostrando o *Problema* (onde falta preço/tributação), o estoque e a região a corrigir.\n\n` +
        `_Envio de validação._`;

    // 2) Cria campanha temporária com o xlsx anexado
    const base64 = fs.readFileSync(XLSX_PATH).toString('base64');
    const created = await req('POST', '/api/campaigns', {
        name: '[TEMP] Envio ION mesclado',
        sendType: 'consolidated',
        recipients: [RECIPIENT],
        selectQuery: 'SELECT 1 AS N FROM DUAL',
        rowTemplate: '​',           // conteúdo invisível: mantém a legenda limpa
        personalizedText: caption,
        imageData: base64,               // sem prefixo data: — salvo como xlsx
        imageName: 'prods_pend_cad.xlsx',
        active: true
    });
    if (!created.body || !created.body.campaign) { console.error('Falha ao criar campanha:', JSON.stringify(created)); return; }
    const id = created.body.campaign.id;
    console.log('Campanha temporária criada:', id);

    let triggerRes;
    try {
        // 3) Dispara
        console.log(`Enviando planilha mesclada para ${RECIPIENT}...`);
        triggerRes = await req('POST', `/api/campaigns/${id}/trigger`, {});
        console.log('HTTP', triggerRes.status);
        console.log('Resultado:', JSON.stringify(triggerRes.body || triggerRes.raw, null, 2));
    } finally {
        // 4) Limpeza: apaga a campanha temporária e o arquivo anexado
        const del = await req('DELETE', `/api/campaigns/${id}`);
        console.log('Campanha temporária removida:', del.status === 200 ? 'OK' : JSON.stringify(del));
    }
}
main().catch(e => console.error('FALHA:', e.message));
