require('dotenv').config();
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const database = require('../src/config/database');
const wtaOrderService = require('../src/services/wtaOrderService');
const logger = require('../src/utils/logger');

const MOCK_EXCEL_PATH = path.join(__dirname, 'mock_cotacao.xlsx');

/**
 * Cria uma planilha Excel temporária com dados de cotação fictícios para testes.
 */
async function createMockExcel() {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Cotação');

    // Cabeçalho exatamente igual ao solicitado pelo usuário
    ws.addRow([
        'ordem compra', 'Item', 'Produto', 'codprod', 'Descricao', 'UM', 'QTD', 'Valor Unit.', 'Valor Total', 'Dt. Entrega', 'centro custo', 'Codendereço ', 'Desc.CC'
    ]);

    // Linha 1: Produto real com endereço válido (para Interativa Facilities 55466)
    ws.addRow([
        'OC-102030', 1, 'PRODUTO TESTE 1', 18179, 'DESC MOCK PROD 1', 'UN', 10, 15.50, 155.00, '2026-07-20', 'CC-ADM', 1961, 'Administrativo Matriz'
    ]);

    // Linha 2: Produto inexistente (para testar tratamento de erros)
    ws.addRow([
        'OC-102030', 2, 'PRODUTO INEXISTENTE', 999999, 'DESC MOCK INEXISTENTE', 'UN', 2, 45.00, 90.00, '2026-07-20', 'CC-ADM', 1961, 'Administrativo Matriz'
    ]);

    // Linha 3: Produto real com quantidade maior que o estoque ou endereço inexistente
    ws.addRow([
        'OC-102030', 3, 'PRODUTO TESTE 1', 18179, 'DESC MOCK PROD 1', 'UN', 50000, 15.50, 775000.00, '2026-07-20', 'CC-DIR', 99, 'Diretoria'
    ]);

    // Linha 4: Produto real com outro endereço de entrega válido (para testar divisão/split de pedidos)
    ws.addRow([
        'OC-102030', 4, 'PRODUTO TESTE 1', 18179, 'DESC MOCK PROD 1', 'UN', 5, 8.90, 44.50, '2026-07-20', 'CC-HECAD', 1963, 'Hospital da Criança'
    ]);

    await workbook.xlsx.writeFile(MOCK_EXCEL_PATH);
    console.log(`Planilha de simulação criada em: ${MOCK_EXCEL_PATH}`);
}

async function run() {
    try {
        // 1. Inicializa Conexão Oracle
        await database.initialize();

        // 2. Garante a existência da planilha simulada
        await createMockExcel();

        // 3. Executa a Fase 1: Leitura e extração do Excel
        console.log('\n--- 📂 FASE 1: LEITURA E PARSER DO EXCEL ---');
        const items = await wtaOrderService.parseQuoteExcel(MOCK_EXCEL_PATH);
        console.log(`Itens lidos do Excel: ${items.length}`);
        console.table(items.map(i => ({
            OC: i.ordem_compra,
            Item: i.item,
            CodProd: i.codprod,
            Qtd: i.qtd,
            ValUnit: i.valor_unit,
            CodEnd: i.codendereco
        })));

        // 4. Executa a Fase 1.5: Pré-validação com Banco de Dados Oracle
        console.log('\n--- 🔍 FASE 1.5: PRÉ-VALIDAÇÃO NO BANCO DE DADOS ---');
        const validation = await wtaOrderService.validateQuote(items, 55466); // Cliente: 55466 (Interativa)
        console.log(`Valores gerais de validação:`);
        console.log(`- Contém erros impeditivos: ${validation.hasErrors ? '❌ SIM' : '✅ NÃO'}`);
        console.log(`- Total itens: ${validation.totalItems}`);
        console.log(`- Válidos: ${validation.validItemsCount}`);
        console.log(`- Inválidos/Erros: ${validation.invalidItemsCount}`);

        console.log('\nDetalhamento dos Itens Validados:');
        validation.items.forEach((item, idx) => {
            console.log(`\nItem ${idx + 1} (CodProd: ${item.codprod}, Endereço: ${item.codendereco}):`);
            console.log(`  - Válido para importação: ${item.isValid ? '✅ Sim' : '❌ Não'}`);
            console.log(`  - Saldo em Estoque: ${item.saldoDisponivel} unidades`);
            console.log(`  - Preço de Tabela: R$ ${item.precoTabela ? item.precoTabela.toFixed(2) : 'N/A'}`);
            console.log(`  - Endereço Descrição: ${item.enderecoDesc}`);
            if (item.errors.length > 0) {
                console.log(`  - Erros:`, item.errors);
            }
            if (item.warnings.length > 0) {
                console.log(`  - Alertas:`, item.warnings);
            }
        });

        // 5. Executa a Fase 2: Geração e simulação de payloads WTA agrupados por endereço
        console.log('\n--- 🚀 FASE 2: SIMULAÇÃO DE SUBMISSÃO WTA ---');
        const integrationResult = await wtaOrderService.submitToWTA(validation.items, 55466, 86);
        console.log(`Resultado da Integração no WTA:`);
        console.log(`- Sucesso geral: ${integrationResult.success ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`- Pedidos criados/simulados: ${integrationResult.integratedCount}`);
        console.log(`- Pedidos com falha: ${integrationResult.failedCount}`);
        
        integrationResult.orders.forEach(order => {
            console.log(`\nPedido para Endereço ${order.codEnd}:`);
            if (order.success) {
                console.log(`  - Status: Sucesso ✅`);
                console.log(`  - Número do Pedido WinThor: ${order.numPed}`);
                console.log(`  - Payload salvo em: ${order.payloadPath}`);
            } else {
                console.log(`  - Status: Erro ❌`);
                console.log(`  - Mensagem: ${order.error}`);
            }
        });

        // 6. Limpeza do arquivo mock de teste
        try {
            fs.unlinkSync(MOCK_EXCEL_PATH);
            console.log(`\nArquivo de teste mock removido.`);
        } catch (e) {}

    } catch (err) {
        console.error('Erro na execução do fluxo de testes:', err);
    } finally {
        // Encerra conexão com o pool do banco
        await database.close();
    }
}

run();
