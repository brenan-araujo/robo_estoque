const { getContacts } = require('./contactsManager');
const { getVendedorByPhone, phoneKey } = require('./vendedores');
const logger = require('./logger');

// Resolve quem está falando com a BIA. Fonte primária: contacts.json
// (sincronizado da PCUSUARI — vendedores, supervisores e admins). Fallback:
// vendedores_telefones.csv. A comparação de telefone tolera 9º dígito, DDI e
// sufixos de JID (@c.us/@lid) via phoneKey.
function resolve(phone) {
    const key = phoneKey(phone);

    if (key) {
        for (const c of getContacts()) {
            if (!c || c.role === 'grupo') continue;
            if (phoneKey(c.phone) === key) {
                return {
                    authorized: true,
                    name: c.name,
                    role: c.role,
                    filial: c.filial && c.filial !== 'N/A' ? c.filial : null,
                    rcaCode: c.rcaCode && c.rcaCode !== 'N/A' ? c.rcaCode : null,
                    source: 'contacts',
                };
            }
        }
    }

    // Fallback: CSV de vendedores (caso o contato ainda não esteja no contacts.json)
    const v = getVendedorByPhone(phone);
    if (v) {
        return {
            authorized: true,
            name: v.nome,
            role: 'vendedor',
            filial: v.codFilial || null,
            rcaCode: v.rca || null,
            source: 'csv',
        };
    }

    logger.info(`[Bia] Número não autorizado: ${phone}`);
    return { authorized: false, name: null, role: null, filial: null, rcaCode: null, source: null };
}

module.exports = { resolve };
