const logger = require('../utils/logger');

/**
 * Envia uma lista de produtos para o Google Apps Script Web App sincronizar com o Planilhas Google
 * @param {Array} products Lista de produtos
 * @returns {Promise<{success: boolean, added: number, message: string}>} Resultado do envio
 */
async function sendProductsToSheets(products) {
    const webappUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;

    if (!webappUrl || webappUrl.includes('PLACEHOLDER') || webappUrl === '') {
        logger.warn('⚠️ Integração com Google Planilhas não configurada no .env (GOOGLE_SHEETS_WEBAPP_URL ausente ou padrão). Sincronização pulada.');
        return { success: false, added: 0, message: 'Google Planilhas não configurado no .env.' };
    }

    if (products.length === 0) {
        return { success: true, added: 0, message: 'Nenhum produto para sincronizar.' };
    }

    logger.info(`Sincronizando ${products.length} produto(s) com o Google Planilhas...`);

    try {
        const response = await fetch(webappUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ products })
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.success) {
            logger.info(`✅ Google Planilhas sincronizado: ${data.added} produto(s) inédito(s) adicionado(s).`);
            return {
                success: true,
                added: data.added,
                message: `${data.added} produto(s) novo(s) inserido(s) na planilha.`
            };
        } else {
            throw new Error(data.error || 'Erro desconhecido retornado pelo Apps Script.');
        }

    } catch (err) {
        logger.error(`❌ Erro ao enviar dados para o Google Planilhas: ${err.message}`);
        throw err;
    }
}

/**
 * Verifica se há produtos pendentes de revisão na planilha do Google (revisado === 'Não' ou unchecked)
 * @returns {Promise<{success: boolean, pendingCount: number, products: Array}>} Resultado da busca
 */
async function checkPendingProducts() {
    const webappUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;

    if (!webappUrl || webappUrl.includes('PLACEHOLDER') || webappUrl === '') {
        logger.warn('⚠️ Integração com Google Planilhas não configurada no .env. Não é possível checar pendências.');
        return { success: false, pendingCount: 0, products: [] };
    }

    logger.info('Buscando produtos pendentes de revisão no Google Planilhas...');

    try {
        const response = await fetch(webappUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'checkPending' })
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.success) {
            logger.info(`✅ Consulta de pendências concluída. ${data.pendingCount} produto(s) pendente(s).`);
            return data;
        } else {
            throw new Error(data.error || 'Erro retornado pelo Apps Script ao consultar pendências.');
        }

    } catch (err) {
        logger.error(`❌ Erro ao consultar pendências no Google Planilhas: ${err.message}`);
        throw err;
    }
}

module.exports = {
    sendProductsToSheets,
    checkPendingProducts
};

