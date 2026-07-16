// Mock oracledb before loading logisticsReportService to bypass real driver init
const mockOracledb = {
    initOracleClient: () => { console.log('Mocked initOracleClient called'); },
    OUT_FORMAT_OBJECT: 4002,
};
require.cache[require.resolve('oracledb')] = {
    id: require.resolve('oracledb'),
    filename: require.resolve('oracledb'),
    loaded: true,
    exports: mockOracledb
};

const { compareAndGenerateDiffText } = require('../src/services/logisticsReportService');

console.log('🧪 Iniciando teste de comparação e diffing de logística (Sexta-Feira -> Quarta-Feira)...');

// 1. Dados simulados de Sexta-Feira (Snapshot)
const snapshotItems = [
    {
        CODFILIAL: '20',
        NUMPED: 10001,
        CODIGO_FORNECEDOR: 123,
        FORNECEDOR: 'FORNECEDOR A',
        CODIGO_PRODUTO: 501,
        DESCRICAO_PRODUTO: 'PRODUTO REGULAR BRAGGO',
        SALDO_PEDIDO: 100,
        QTD_EMB_MASTER: 5,
        PREV_ENTREGA: new Date('2026-06-22T12:00:00.000Z')
    },
    {
        CODFILIAL: '20',
        NUMPED: 10002,
        CODIGO_FORNECEDOR: 123,
        FORNECEDOR: 'FORNECEDOR A',
        CODIGO_PRODUTO: 502,
        DESCRICAO_PRODUTO: 'PRODUTO CANCELADO',
        SALDO_PEDIDO: 200,
        QTD_EMB_MASTER: 10,
        PREV_ENTREGA: new Date('2026-06-23T12:00:00.000Z')
    },
    {
        CODFILIAL: '21',
        NUMPED: 20001,
        CODIGO_FORNECEDOR: 456,
        FORNECEDOR: 'FORNECEDOR B',
        CODIGO_PRODUTO: 601,
        DESCRICAO_PRODUTO: 'PRODUTO QTD ALTERADA',
        SALDO_PEDIDO: 300,
        QTD_EMB_MASTER: 15,
        PREV_ENTREGA: new Date('2026-06-24T12:00:00.000Z')
    },
    {
        CODFILIAL: '21',
        NUMPED: 20002,
        CODIGO_FORNECEDOR: 456,
        FORNECEDOR: 'FORNECEDOR B',
        CODIGO_PRODUTO: 602,
        DESCRICAO_PRODUTO: 'PRODUTO DATA ALTERADA',
        SALDO_PEDIDO: 400,
        QTD_EMB_MASTER: 20,
        PREV_ENTREGA: new Date('2026-06-25T12:00:00.000Z')
    }
];

// 2. Dados simulados de Quarta-Feira (Live atualizado)
const currentItems = [
    // 1. PRODUTO REGULAR - Sem alteração
    {
        CODFILIAL: '20',
        NUMPED: 10001,
        CODIGO_FORNECEDOR: 123,
        FORNECEDOR: 'FORNECEDOR A',
        CODIGO_PRODUTO: 501,
        DESCRICAO_PRODUTO: 'PRODUTO REGULAR BRAGGO',
        SALDO_PEDIDO: 100,
        QTD_EMB_MASTER: 5,
        PREV_ENTREGA: new Date('2026-06-22T12:00:00.000Z')
    },
    // 2. PRODUTO CANCELADO - Removido (não está presente)
    
    // 3. PRODUTO QTD ALTERADA - Modificado (Qtd 300 -> 350)
    {
        CODFILIAL: '21',
        NUMPED: 20001,
        CODIGO_FORNECEDOR: 456,
        FORNECEDOR: 'FORNECEDOR B',
        CODIGO_PRODUTO: 601,
        DESCRICAO_PRODUTO: 'PRODUTO QTD ALTERADA',
        SALDO_PEDIDO: 350,
        QTD_EMB_MASTER: 17.5,
        PREV_ENTREGA: new Date('2026-06-24T12:00:00.000Z')
    },
    // 4. PRODUTO DATA ALTERADA - Modificado (Data 25/06 -> 26/06)
    {
        CODFILIAL: '21',
        NUMPED: 20002,
        CODIGO_FORNECEDOR: 456,
        FORNECEDOR: 'FORNECEDOR B',
        CODIGO_PRODUTO: 602,
        DESCRICAO_PRODUTO: 'PRODUTO DATA ALTERADA',
        SALDO_PEDIDO: 400,
        QTD_EMB_MASTER: 20,
        PREV_ENTREGA: new Date('2026-06-26T12:00:00.000Z')
    },
    // 5. PRODUTO ADICIONADO - Novo pedido/item
    {
        CODFILIAL: '20',
        NUMPED: 10003,
        CODIGO_FORNECEDOR: 123,
        FORNECEDOR: 'FORNECEDOR A',
        CODIGO_PRODUTO: 503,
        DESCRICAO_PRODUTO: 'NOVO PRODUTO ADICIONADO',
        SALDO_PEDIDO: 150,
        QTD_EMB_MASTER: 7.5,
        PREV_ENTREGA: new Date('2026-06-24T12:00:00.000Z')
    }
];

// 3. Executar comparação
const diffText = compareAndGenerateDiffText(currentItems, snapshotItems);

console.log('\n--- TEXTO DE DIFERENÇAS GERADO ---');
console.log(diffText);
console.log('----------------------------------\n');

// 4. Validar resultados esperados
const containsAdded = diffText.includes('NOVO PRODUTO ADICIONADO') && diffText.includes('➕ *Pedidos Adicionados (1):*');
const containsRemoved = diffText.includes('PRODUTO CANCELADO') && diffText.includes('❌ *Pedidos Removidos/Cancelados (1):*');
const containsQtyChanged = diffText.includes('Qtd: 300 → 350 un.');
const containsDateChanged = diffText.includes('Data: Qui 25/06 → Sex 26/06');
const containsModifiedHeader = diffText.includes('📝 *Pedidos Modificados (2):*');

if (containsAdded && containsRemoved && containsQtyChanged && containsDateChanged && containsModifiedHeader) {
    console.log('✅ TESTE APROVADO! Todos os tipos de alterações foram detectados e formatados corretamente.');
} else {
    console.error('❌ TESTE FALHOU! Algumas alterações não foram formatadas conforme o esperado.');
    console.log('Mock checks:', {
        containsAdded,
        containsRemoved,
        containsQtyChanged,
        containsDateChanged,
        containsModifiedHeader
    });
}
