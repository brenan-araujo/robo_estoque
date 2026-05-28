/**
 * Mapeamento dinâmico de CODFILIAL → nome do grupo do WhatsApp e Números de Notificação.
 * Utiliza o configManager para carregar os valores definidos pelo usuário no dashboard.
 */

const configManager = require('../utils/configManager');

module.exports = {
    // Getter dinâmico para compatibilidade
    get FILIAL_GROUPS() {
        return configManager.getSettings().filialGroups;
    },

    // Getter dinâmico para compatibilidade
    get NOTIFY_NUMBERS() {
        return configManager.getNotifyNumbers();
    },

    /**
     * Retorna o nome do grupo do WhatsApp para uma filial
     */
    getGroupNameForFilial(codFilial) {
        return configManager.getGroupNameForFilial(codFilial);
    },

    /**
     * Retorna todas as filiais configuradas (com grupo definido)
     */
    getConfiguredFiliais() {
        return configManager.getConfiguredFiliais();
    }
};
