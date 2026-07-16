const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONTACTS_FILE = path.join(__dirname, '..', '..', 'data', 'contacts.json');
const CSV_FILE = path.join(__dirname, '..', '..', 'vendedores_telefones.csv');
const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

let contactsCache = null;

function normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '').trim();
    if (!cleaned) return '';
    
    // Se não tem DDI, assume BR (+55)
    if (cleaned.length === 10 || cleaned.length === 11) {
        cleaned = '55' + cleaned;
    }
    return cleaned;
}

/**
 * Lê e inicializa a base de contatos.
 * Se contacts.json não existir, executa o auto-seed a partir do CSV.
 */
function getContacts() {
    if (contactsCache) return contactsCache;

    const dir = path.dirname(CONTACTS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(CONTACTS_FILE)) {
        try {
            contactsCache = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
            
            // Injeta grupos padrão se estiverem ausentes
            let updated = false;
            const standardGroups = [
                {
                    id: 'group_20_6',
                    name: 'BRAGO Vendas Comercial Brasília',
                    phone: 'BRAGO Vendas Comercial Brasília',
                    role: 'grupo',
                    filial: '20 + 6',
                    rcaCode: 'N/A'
                },
                {
                    id: 'group_21',
                    name: 'Brago Vendas Comercial Goiânia',
                    phone: 'Brago Vendas Comercial Goiânia',
                    role: 'grupo',
                    filial: '21',
                    rcaCode: 'N/A'
                },
                {
                    id: 'group_22',
                    name: 'Comercial Brago TO',
                    phone: 'Comercial Brago TO',
                    role: 'grupo',
                    filial: '22',
                    rcaCode: 'N/A'
                },
                {
                    id: 'group_23',
                    name: 'Brago - Comercial MS',
                    phone: 'Brago - Comercial MS',
                    role: 'grupo',
                    filial: '23',
                    rcaCode: 'N/A'
                }
            ];
            
            standardGroups.forEach(grp => {
                if (!contactsCache.some(c => c.id === grp.id || (c.role === 'grupo' && c.name === grp.name))) {
                    contactsCache.push(grp);
                    updated = true;
                }
            });
            
            if (updated) {
                saveContacts(contactsCache);
            }
            
            return contactsCache;
        } catch (e) {
            logger.error(`Erro ao ler contacts.json: ${e.message}. Forçando auto-seed.`);
        }
    }

    // Auto-seed
    contactsCache = seedContacts();
    saveContacts(contactsCache);
    return contactsCache;
}

/**
 * Salva a base de contatos no arquivo contacts.json e sincroniza grupos com settings.json
 */
function saveContacts(contacts) {
    try {
        contactsCache = contacts;
        fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2), 'utf8');
        logger.info('👤 Base de contatos atualizada em contacts.json');

        // Sincroniza com settings.json
        if (fs.existsSync(SETTINGS_FILE)) {
            try {
                const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
                if (!settings.filialGroups) settings.filialGroups = {};
                
                // Limpa grupos anteriores (para evitar manter grupos que foram excluídos)
                Object.keys(settings.filialGroups).forEach(k => {
                    settings.filialGroups[k] = '';
                });

                // Preenche com os grupos ativos dos contatos
                contacts.forEach(c => {
                    if (c.role === 'grupo' && c.filial) {
                        const filialStr = String(c.filial).trim();
                        // Se filial for combinada (ex: '20 + 6')
                        if (filialStr === '20 + 6' || filialStr === '20' || filialStr === '6') {
                            settings.filialGroups['20'] = c.name;
                            settings.filialGroups['6'] = c.name;
                        } else {
                            settings.filialGroups[filialStr] = c.name;
                        }
                    }
                });

                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
                logger.info('⚙️ Mapeamento de grupos sincronizado em settings.json');
            } catch (err) {
                logger.error(`Erro ao sincronizar filialGroups com settings.json: ${err.message}`);
            }
        }

        return true;
    } catch (e) {
        logger.error(`Erro ao salvar contacts.json: ${e.message}`);
        return false;
    }
}

/**
 * Realiza a carga inicial do CSV e atribui perfis e equipes
 */
function seedContacts() {
    logger.info('🌱 Iniciando auto-seed da base de contatos com IDs únicos...');
    const contacts = [];
    const idSet = new Set();

    // Helper para adicionar sem duplicar ID
    const addContact = (contact) => {
        if (!idSet.has(contact.id)) {
            contacts.push(contact);
            idSet.add(contact.id);
        }
    };

    // 1. Carrega administradores do settings.json
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            const admins = settings.notifyNumbers || [];
            admins.forEach((adminPhone, index) => {
                const norm = normalizePhone(adminPhone);
                if (norm) {
                    addContact({
                        id: `admin_${norm}`,
                        name: `Administrador ${index + 1}`,
                        phone: norm,
                        role: 'admin',
                        filial: 'N/A',
                        rcaCode: 'N/A'
                    });
                }
            });
        } catch (e) {
            logger.warn(`Não foi possível carregar admins no seed: ${e.message}`);
        }
    }

    // Adiciona admin de teste principal se não listado
    const mainAdmin = '5561983391951';
    addContact({
        id: `admin_${mainAdmin}`,
        name: 'Administrador (Bia Teste)',
        phone: mainAdmin,
        role: 'admin',
        filial: 'N/A',
        rcaCode: 'N/A'
    });

    // 2. Lê e parseia o CSV de vendedores
    if (fs.existsSync(CSV_FILE)) {
        try {
            const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
            const lines = csvContent.split(/\r?\n/);
            
            for (let i = 1; i < lines.length; i++) { // Pula cabeçalho
                const line = lines[i].trim();
                if (!line) continue;

                // Código RCA;Nome Vendedor;Código Filial;Filial Formatada;Telefone 1;Telefone 2;Tel WhatsApp
                const cols = line.split(';');
                if (cols.length < 3) continue;

                const rcaCode = cols[0].trim();
                const name = cols[1].trim();
                const filial = cols[2].trim();
                
                // Prioriza "Tel WhatsApp", depois "Telefone 1"
                let rawPhone = (cols[6] || cols[4] || '').trim();
                const phone = normalizePhone(rawPhone);

                if (!phone) {
                    logger.warn(`Vendedor ${name} (RCA ${rcaCode}) não possui telefone válido no CSV. Pulando.`);
                    continue;
                }

                let role = 'vendedor';
                let filialValue = filial;
                let supervisingFiliais = undefined;
                let supervisingRcas = undefined;

                const nameUpper = name.toUpperCase();

                // 2a. Identifica vendedoras internas (Ines, Flávia, Débora, Nayara) -> Filial: TODAS
                if (nameUpper.includes('INES GOMES') || 
                    nameUpper.includes('FLAVIA DUTRA') || 
                    nameUpper.includes('DEBORA MARIA') || 
                    nameUpper.includes('NAIARA SANTOS')) {
                    filialValue = 'TODAS';
                }

                // 2b. Diferenciação de Supervisores
                if (nameUpper.includes('KEYLA SALES')) {
                    role = 'supervisor';
                    supervisingFiliais = ['20', '23']; // Brasília e Campo Grande
                } else if (nameUpper.includes('LEANDRO BORJA')) {
                    role = 'supervisor';
                    supervisingFiliais = ['21', '22']; // Goiânia e Palmas
                } else if (nameUpper.includes('OZEAS DE CASTRO') || nameUpper.includes('OZEAS CASTRO')) {
                    role = 'supervisor';
                    supervisingFiliais = ['21', '22']; // Goiânia e Palmas
                } else if (nameUpper.includes('ELIANE AREA')) {
                    role = 'supervisor';
                    supervisingRcas = ['84', '99', '91', '88']; // Ines, Flávia, Débora, Nayara
                } else if (nameUpper.includes('POLIANI SANTOS')) {
                    role = 'supervisor';
                    supervisingRcas = ['108', '1102']; // Tayane e Hadassa
                }

                // Cria ID baseado na regra
                let id;
                if (role === 'supervisor') {
                    id = `supervisor_${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                } else {
                    id = `rca_${rcaCode}`;
                }

                addContact({
                    id,
                    name,
                    phone,
                    role,
                    filial: filialValue,
                    rcaCode,
                    ...(supervisingFiliais && { supervisingFiliais }),
                    ...(supervisingRcas && { supervisingRcas })
                });
            }
        } catch (e) {
            logger.error(`Erro ao processar CSV de contatos no seed: ${e.message}`);
        }
    }

    // 3. Adiciona Edson Farias (Brasília/Campo Grande) se ausente
    const edsonPhone = '5561999980000'; // Placeholder
    addContact({
        id: 'supervisor_edson_farias',
        name: 'EDSON FARIAS',
        phone: edsonPhone,
        role: 'supervisor',
        filial: '20',
        rcaCode: '105',
        supervisingFiliais: ['20', '23']
    });

    // 4. Adiciona Rivelino se ausente
    const rivelinoPhone = '5561998097323';
    addContact({
        id: 'supervisor_rivelino',
        name: 'RIVELINO',
        phone: rivelinoPhone,
        role: 'supervisor',
        filial: 'TODAS',
        rcaCode: '9999',
        supervisingFiliais: ['ALL']
    });

    // 5. Adiciona os grupos padrão do WhatsApp
    addContact({
        id: 'group_20_6',
        name: 'BRAGO Vendas Comercial Brasília',
        phone: 'BRAGO Vendas Comercial Brasília',
        role: 'grupo',
        filial: '20 + 6',
        rcaCode: 'N/A'
    });
    addContact({
        id: 'group_21',
        name: 'Brago Vendas Comercial Goiânia',
        phone: 'Brago Vendas Comercial Goiânia',
        role: 'grupo',
        filial: '21',
        rcaCode: 'N/A'
    });
    addContact({
        id: 'group_22',
        name: 'Comercial Brago TO',
        phone: 'Comercial Brago TO',
        role: 'grupo',
        filial: '22',
        rcaCode: 'N/A'
    });
    addContact({
        id: 'group_23',
        name: 'Brago - Comercial MS',
        phone: 'Brago - Comercial MS',
        role: 'grupo',
        filial: '23',
        rcaCode: 'N/A'
    });

    logger.info(`🌱 Seed de contatos concluído com sucesso. Mapeados ${contacts.length} usuários.`);
    return contacts;
}

module.exports = {
    getContacts,
    saveContacts
};
