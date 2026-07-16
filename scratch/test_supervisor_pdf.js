const path = require('path');
const fs = require('fs');

// Carrega variáveis de ambiente
require('dotenv').config();

const logger = require('../src/utils/logger');
const contactsManager = require('../src/utils/contactsManager');
const sentTracker = require('../src/utils/sentTracker');
const whatsapp = require('../src/services/whatsappService');
const supervisorReportService = require('../src/services/supervisorReportService');
const oracleService = require('../src/services/oracleService');

async function test() {
    logger.info('🧪 Iniciando teste de Relatórios de Supervisores...');

    // 1. Inicializa os contatos se necessário
    contactsManager.getContacts();

    // 2. Moca um corte resolvido hoje em sent_messages.json
    logger.info('✍️ Gravando corte resolvido mocado no histórico para teste...');
    const mockDetails = {
        type: 'cut_resolved',
        numped: '1003020916',
        rca: '1003',
        nome_rca: 'IVAM SENA',
        codcli: '26854',
        cliente: 'FORMPAN INDUSTRIA DE PAO LTDA',
        items: [
            { codprod: '1361', descricao: 'PRATO P/BOLO MP28 C/BORDA C/200 UN', qt_falta: 6, qtDisp: 10 },
            { codprod: '1552', descricao: 'GARRAFA TERMICA 1L INOX', qt_falta: 2, qtDisp: 5 }
        ],
        codFilial: '21'
    };

    sentTracker.trackSent(
        'number',
        '5561983391951',
        'Mensagem mock de corte resolvido',
        2,
        mockDetails
    );

    // Moca outro corte para testar supervisor Eliane Area (equipe de vendedoras internas)
    const mockDetailsInternal = {
        type: 'cut_resolved',
        numped: '1003029999',
        rca: '88', // Nayara Santos (supervisionada por Eliane Area)
        nome_rca: 'NAIARA SANTOS',
        codcli: '99912',
        cliente: 'PADARIA SUPER PAO LTDA',
        items: [
            { codprod: '2022', descricao: 'DESCARTAVEL COPO 200ML C/100', qt_falta: 10, qtDisp: 50 }
        ],
        codFilial: '20'
    };

    sentTracker.trackSent(
        'number',
        '5561983391951',
        'Mensagem mock de corte resolvido interna',
        1,
        mockDetailsInternal
    );

    logger.info('✅ Cortes mocados gravados com sucesso.');

    // 3. Moca os produtos que chegaram (entradas) sobresscrevendo temporariamente a função getFunnelProducts
    const originalGetFunnelProducts = oracleService.getFunnelProducts;
    oracleService.getFunnelProducts = async () => {
        logger.info('🔮 [Mock] Retornando lista de entradas de teste do dia');
        return [
            {
                NUMTRANSENT: 123456,
                CODPROD: 1361,
                DESCRICAO: 'PRATO P/BOLO MP28 C/BORDA C/200 UN',
                CODFILIAL: 21,
                NOMEFILIAL: 'BRAGO GOIANIA',
                QT: 50,
                NUMNOTA: 95521,
                DTMOV: new Date(),
                CODOPER: 'E',
                FORNECEDOR: 'FORMEST IND. EMBALAGENS',
                DTDESBLOQUEIO: new Date(),
                QTDESBLOQUEADA: 50,
                TEM_PENDENCIA: 'N'
            },
            {
                NUMTRANSENT: 123457,
                CODPROD: 2022,
                DESCRICAO: 'DESCARTAVEL COPO 200ML C/100',
                CODFILIAL: 20,
                NOMEFILIAL: 'BRAGO BRASILIA',
                QT: 1000,
                NUMNOTA: 95522,
                DTMOV: new Date(),
                CODOPER: 'E',
                FORNECEDOR: 'COPOBRAS S/A',
                DTDESBLOQUEIO: new Date(),
                QTDESBLOQUEADA: 1000,
                TEM_PENDENCIA: 'N'
            }
        ];
    };

    // 4. Inicializa o cliente do WhatsApp para testar o envio
    logger.info('📱 Inicializando cliente do WhatsApp (certifique-se de que o painel principal não esteja rodando para evitar conflito de sessão)...');
    
    try {
        await whatsapp.initialize();
        logger.info('✅ WhatsApp inicializado e conectado.');

        // 5. Roda a rotina de envio de relatórios de supervisores (forçando envio)
        logger.info('🚀 Executando supervisorReportService.sendSupervisorReports(true)...');
        const results = await supervisorReportService.sendSupervisorReports(true);
        logger.info(`🎉 Teste concluído! Sucessos: ${results.successCount}, Falhas: ${results.errorCount}`);

    } catch (err) {
        logger.error(`❌ Erro no teste: ${err.message}`);
    } finally {
        // Encerra conexão do WhatsApp
        await whatsapp.destroy();
        
        // Restaura função original
        oracleService.getFunnelProducts = originalGetFunnelProducts;
        logger.info('🧹 Recursos e funções originais restaurados.');
    }
}

// Roda o teste
test().catch(err => console.error(err));
