const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 0. Carrega o .env da aplicação
require('dotenv').config();

// Mock do setTimeout para rodar os delays instantaneamente
const originalSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => {
    return originalSetTimeout(fn, 0);
};

// Mockando dependências do whatsapp e oracleService ANTES de qualquer require da aplicação
const whatsapp = require('../src/services/whatsappService');
const oracleService = require('../src/services/oracleService');

const originalSendToGroup = whatsapp.sendToGroup;
const originalSendToNumber = whatsapp.sendToNumber;
const originalIsClientReady = whatsapp.isClientReady;
const originalGetNewEntries = oracleService.getNewEntries;

let groupCalls = 0;
let numberCalls = [];

whatsapp.isClientReady = () => true;
whatsapp.sendToGroup = async (groupName, message, itemCount, details) => {
    groupCalls++;
    return true;
};
whatsapp.sendToNumber = async (number, message, itemCount, details) => {
    numberCalls.push(number);
    return true;
};

oracleService.getNewEntries = async (lastUnlockDate) => {
    return [
        {
            NUMTRANSENT: 99999,
            CODPROD: 88888,
            DESCRICAO: 'PRODUTO TESTE',
            CODFILIAL: '20',
            NOMEFILIAL: 'FILIAL TESTE',
            QT: 10,
            NUMNOTA: 12345,
            DTMOV: new Date(),
            CODOPER: 'E',
            FORNECEDOR: 'FORN TESTE',
            DTDESBLOQUEIO: '2026-06-05T12:00:00.000Z',
            TEM_PENDENCIA: 'N',
            QTDISP: 10,
            QTPEND: 0
        }
    ];
};

const configManager = require('../src/utils/configManager');
const originalGetNotifyNumbers = configManager.getNotifyNumbers;
const originalGetFilialNumbers = configManager.getFilialNumbers;
const originalGetGroupNameForFilial = configManager.getGroupNameForFilial;

configManager.getNotifyNumbers = () => ['5561999990001'];
configManager.getGroupNameForFilial = (codFilial) => {
    if (codFilial === '20') return 'Grupo Teste Filial 20';
    return null;
};
configManager.getFilialNumbers = (codFilial) => {
    if (codFilial === '20') return ['5561999990002'];
    return [];
};

// Paths
const processedKeysFile = path.join(__dirname, '..', 'data', 'processed_keys.json');
const sentTargetsFile = path.join(__dirname, '..', 'data', 'sent_targets.json');
const stateFile = path.join(__dirname, '..', 'data', 'state.json');

let processedBackup = null;
if (fs.existsSync(processedKeysFile)) processedBackup = fs.readFileSync(processedKeysFile, 'utf8');

let targetsBackup = null;
if (fs.existsSync(sentTargetsFile)) targetsBackup = fs.readFileSync(sentTargetsFile, 'utf8');

function resetState() {
    fs.writeFileSync(processedKeysFile, '[]', 'utf8');
    fs.writeFileSync(sentTargetsFile, '{}', 'utf8');
    fs.writeFileSync(stateFile, JSON.stringify({ lastUnlockDate: '2026-06-03T12:00:00.000Z' }), 'utf8');
    
    // Limpa o cache do require para forçar o recarregamento dos arquivos de estado da memória
    delete require.cache[require.resolve('../src/jobs/checkProducts')];
    delete require.cache[require.resolve('../src/utils/targetTracker')];
}

async function runTest() {
    console.log('--- TESTANDO EXECUÇÃO DO JOB checkNewProducts ---');
    
    // Reseta estado e carrega o job
    resetState();
    let checkProducts = require('../src/jobs/checkProducts');
    let targetTracker = require('../src/utils/targetTracker');
    
    // Executa o checkNewProducts pela primeira vez
    await checkProducts.checkNewProducts();
    
    console.log('Primeira execução concluída.');
    console.log(`- Chamadas de Grupo: ${groupCalls}`);
    console.log(`- Chamadas de Número (Admins + Vendedores): ${JSON.stringify(numberCalls)}`);
    
    assert.strictEqual(groupCalls, 1, 'Deveria ter enviado 1 mensagem de grupo');
    assert.deepEqual(numberCalls, ['5561999990001', '5561999990002'], 'Deveria ter enviado para admin e vendedor');
    
    // Reinicia contadores
    groupCalls = 0;
    numberCalls = [];
    
    // Executa a segunda vez. Não deve enviar nada porque já foi completamente concluído e marcado como processado.
    await checkProducts.checkNewProducts();
    
    console.log('Segunda execução concluída.');
    console.log(`- Chamadas de Grupo: ${groupCalls}`);
    console.log(`- Chamadas de Número: ${JSON.stringify(numberCalls)}`);
    
    assert.strictEqual(groupCalls, 0, 'Não deveria reenviar para o grupo');
    assert.strictEqual(numberCalls.length, 0, 'Não deveria reenviar para ninguém');
    
    // Teste 3: Simula envio parcial (reinício antes do segundo vendedor receber)
    resetState();
    checkProducts = require('../src/jobs/checkProducts');
    targetTracker = require('../src/utils/targetTracker');
    
    // Configura 2 vendedores
    configManager.getFilialNumbers = (codFilial) => {
        if (codFilial === '20') return ['5561999990002', '5561999990003'];
        return [];
    };
    
    // Faz a execução lançar um erro simulando reinício após o primeiro vendedor receber
    let numberIndex = 0;
    whatsapp.sendToNumber = async (number, message, itemCount, details) => {
        numberIndex++;
        // 1ª chamada = Admin (5561999990001)
        // 2ª chamada = Seller 1 (5561999990002)
        // 3ª chamada = Seller 2 (5561999990003) -> Simula queda
        if (numberIndex === 3) {
            throw new Error('SIMULATED_RESTART');
        }
        numberCalls.push(number);
        return true;
    };
    
    try {
        await checkProducts.checkNewProducts();
    } catch (e) {
        assert.strictEqual(e.message, 'SIMULATED_RESTART');
    }
    
    console.log('Execução parcial (simulação de reinício) concluída.');
    console.log(`- Chamadas de Número: ${JSON.stringify(numberCalls)}`);
    assert.deepEqual(numberCalls, ['5561999990001', '5561999990002']);
    
    // Agora executa a segunda vez pós-reinício com fluxo normal
    groupCalls = 0;
    numberCalls = [];
    whatsapp.sendToNumber = async (number, message, itemCount, details) => {
        numberCalls.push(number);
        return true;
    };
    
    // Recarrega o checkProducts e targetTracker para simular o reinício da aplicação
    delete require.cache[require.resolve('../src/jobs/checkProducts')];
    delete require.cache[require.resolve('../src/utils/targetTracker')];
    checkProducts = require('../src/jobs/checkProducts');
    targetTracker = require('../src/utils/targetTracker');
    
    await checkProducts.checkNewProducts();
    
    console.log('Execução pós-reinício concluída.');
    console.log(`- Chamadas de Grupo: ${groupCalls}`);
    console.log(`- Chamadas de Número: ${JSON.stringify(numberCalls)}`);
    
    assert.strictEqual(groupCalls, 0, 'Não deveria reenviar para o grupo');
    assert.deepEqual(numberCalls, ['5561999990003'], 'Deveria enviar APENAS para o segundo vendedor pendente');
    
    // Restaurando originais
    whatsapp.sendToGroup = originalSendToGroup;
    whatsapp.sendToNumber = originalSendToNumber;
    whatsapp.isClientReady = originalIsClientReady;
    oracleService.getNewEntries = originalGetNewEntries;
    configManager.getNotifyNumbers = originalGetNotifyNumbers;
    configManager.getFilialNumbers = originalGetFilialNumbers;
    configManager.getGroupNameForFilial = originalGetGroupNameForFilial;
    global.setTimeout = originalSetTimeout;
    
    if (processedBackup) fs.writeFileSync(processedKeysFile, processedBackup, 'utf8');
    if (targetsBackup) fs.writeFileSync(sentTargetsFile, targetsBackup, 'utf8');
    
    console.log('Todos os testes de integração com checkNewProducts passaram com sucesso!');
}

runTest().catch(e => {
    console.error('Falha nos testes de integração:', e);
    process.exit(1);
});
