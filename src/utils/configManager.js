const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const contactsManager = require('./contactsManager');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');
const DATA_DIR = path.dirname(SETTINGS_FILE);

const DEFAULT_SETTINGS = {
    pollIntervalMinutes: 1,
    // Chegada de Estoque & Cortes:
    // - arrivalDelayMinutes: minutos entre o alerta de corte (vendedor prioritário)
    //   e o broadcast geral de chegada para a filial. 0 = broadcast imediato.
    // - cutAlertEnabled: liga/desliga o alerta de corte resolvido.
    // - cutWindowDays: janela (dias) para considerar cortes/faltas/rejeições pendentes.
    // - cutFallbackNumber: número que recebe o alerta quando o RCA não está no cadastro.
    arrivalDelayMinutes: 10,
    cutAlertEnabled: true,
    cutWindowDays: 30,
    cutFallbackNumber: '5561983391951',
    notifyNumbers: [
        '5561983391951',
        '5561998097323',
        '5561999797868'
    ],
    pdfNotifyNumbers: [],
    salesPdfNotifyNumbers: ['5561983391951'],
    filialGroups: {
        '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '', '10': '',
        '11': '', '12': '', '13': '', '20': '', '21': '', '22': '', '23': '', '24': ''
    },
    filialNumbers: {
        '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '', '10': '',
        '11': '', '12': '', '13': '', '20': '', '21': '', '22': '', '23': '', '24': ''
    },
    // Rupture Report Settings
    rupturePisoEstoque: 0,
    ruptureJanelaGiro: 90,
    ruptureMinDiasComVenda: 12,
    ruptureJanelaVendaRecente: 30,
    ruptureCronTime: "30 18 * * 1-5",
    ruptureNotifyNumbers: [],
    // Purchasing Report Settings
    purchasingNotifyNumbers: [],
    purchasingCronTime: "30 07 * * 5",
    purchasingLimiarAtencao: 5,
    // Other Scheduler Cron Settings
    pdfCronTime: "15 17 * * 1-5",
    salesPdfCronTime: "30 17 * * 1-5",
    newProductsCronTime: "30 07 * * 1-5",
    supervisorCronTime: "35 17 * * 1-5",
    personalizedProductsCronTime: "00 08 * * 1-5",
    logisticsNotifyNumbers: {
        '20 + 6': ['5561983391951', '5562996101684'],
        '21': [],
        '22': [],
        '23': [],
        'GERAL': []
    },
    logisticsNotifyEmails: {
        '20 + 6': [],
        '21': [],
        '22': [],
        '23': [],
        'GERAL': []
    }
};

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Carrega as configurações vigentes
 */
function getSettings() {
    ensureDataDir();
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const parsed = JSON.parse(fileContent);
            // Faz um merge com os padrões caso falte alguma chave
            return {
                pollIntervalMinutes: parsed.pollIntervalMinutes !== undefined ? parsed.pollIntervalMinutes : DEFAULT_SETTINGS.pollIntervalMinutes,
                arrivalDelayMinutes: parsed.arrivalDelayMinutes !== undefined ? parsed.arrivalDelayMinutes : DEFAULT_SETTINGS.arrivalDelayMinutes,
                cutAlertEnabled: parsed.cutAlertEnabled !== undefined ? parsed.cutAlertEnabled : DEFAULT_SETTINGS.cutAlertEnabled,
                cutWindowDays: parsed.cutWindowDays !== undefined ? parsed.cutWindowDays : DEFAULT_SETTINGS.cutWindowDays,
                cutFallbackNumber: parsed.cutFallbackNumber !== undefined ? parsed.cutFallbackNumber : DEFAULT_SETTINGS.cutFallbackNumber,
                notifyNumbers: Array.isArray(parsed.notifyNumbers) ? parsed.notifyNumbers : DEFAULT_SETTINGS.notifyNumbers,
                pdfNotifyNumbers: Array.isArray(parsed.pdfNotifyNumbers) ? parsed.pdfNotifyNumbers : DEFAULT_SETTINGS.pdfNotifyNumbers,
                salesPdfNotifyNumbers: Array.isArray(parsed.salesPdfNotifyNumbers) ? parsed.salesPdfNotifyNumbers : DEFAULT_SETTINGS.salesPdfNotifyNumbers,
                filialGroups: { ...DEFAULT_SETTINGS.filialGroups, ...parsed.filialGroups },
                filialNumbers: { ...DEFAULT_SETTINGS.filialNumbers, ...parsed.filialNumbers || {} },
                rupturePisoEstoque: parsed.rupturePisoEstoque !== undefined ? parsed.rupturePisoEstoque : DEFAULT_SETTINGS.rupturePisoEstoque,
                ruptureJanelaGiro: parsed.ruptureJanelaGiro !== undefined ? parsed.ruptureJanelaGiro : DEFAULT_SETTINGS.ruptureJanelaGiro,
                ruptureMinDiasComVenda: parsed.ruptureMinDiasComVenda !== undefined ? parsed.ruptureMinDiasComVenda : DEFAULT_SETTINGS.ruptureMinDiasComVenda,
                ruptureJanelaVendaRecente: parsed.ruptureJanelaVendaRecente !== undefined ? parsed.ruptureJanelaVendaRecente : DEFAULT_SETTINGS.ruptureJanelaVendaRecente,
                ruptureCronTime: parsed.ruptureCronTime !== undefined ? parsed.ruptureCronTime : DEFAULT_SETTINGS.ruptureCronTime,
                ruptureNotifyNumbers: Array.isArray(parsed.ruptureNotifyNumbers) ? parsed.ruptureNotifyNumbers : DEFAULT_SETTINGS.ruptureNotifyNumbers,
                purchasingNotifyNumbers: Array.isArray(parsed.purchasingNotifyNumbers) ? parsed.purchasingNotifyNumbers : DEFAULT_SETTINGS.purchasingNotifyNumbers,
                purchasingCronTime: parsed.purchasingCronTime !== undefined ? parsed.purchasingCronTime : DEFAULT_SETTINGS.purchasingCronTime,
                purchasingLimiarAtencao: parsed.purchasingLimiarAtencao !== undefined ? parsed.purchasingLimiarAtencao : DEFAULT_SETTINGS.purchasingLimiarAtencao,
                pdfCronTime: parsed.pdfCronTime !== undefined ? parsed.pdfCronTime : DEFAULT_SETTINGS.pdfCronTime,
                salesPdfCronTime: parsed.salesPdfCronTime !== undefined ? parsed.salesPdfCronTime : DEFAULT_SETTINGS.salesPdfCronTime,
                newProductsCronTime: parsed.newProductsCronTime !== undefined ? parsed.newProductsCronTime : DEFAULT_SETTINGS.newProductsCronTime,
                supervisorCronTime: parsed.supervisorCronTime !== undefined ? parsed.supervisorCronTime : DEFAULT_SETTINGS.supervisorCronTime,
                personalizedProductsCronTime: parsed.personalizedProductsCronTime !== undefined ? parsed.personalizedProductsCronTime : DEFAULT_SETTINGS.personalizedProductsCronTime,
                logisticsNotifyNumbers: parsed.logisticsNotifyNumbers !== undefined ? parsed.logisticsNotifyNumbers : DEFAULT_SETTINGS.logisticsNotifyNumbers,
                logisticsNotifyEmails: parsed.logisticsNotifyEmails !== undefined ? parsed.logisticsNotifyEmails : DEFAULT_SETTINGS.logisticsNotifyEmails
            };
        }
    } catch (err) {
        logger.warn(`Erro ao ler settings.json: ${err.message}. Usando padrões.`);
    }
    return { ...DEFAULT_SETTINGS };
}

/**
 * Salva as novas configurações
 */
function saveSettings(settings) {
    ensureDataDir();
    try {
        const toSave = {
            pollIntervalMinutes: parseInt(settings.pollIntervalMinutes) || DEFAULT_SETTINGS.pollIntervalMinutes,
            arrivalDelayMinutes: settings.arrivalDelayMinutes !== undefined && !isNaN(parseInt(settings.arrivalDelayMinutes))
                ? Math.max(0, parseInt(settings.arrivalDelayMinutes)) : DEFAULT_SETTINGS.arrivalDelayMinutes,
            cutAlertEnabled: settings.cutAlertEnabled !== undefined ? settings.cutAlertEnabled === true || settings.cutAlertEnabled === 'true' : DEFAULT_SETTINGS.cutAlertEnabled,
            cutWindowDays: settings.cutWindowDays !== undefined && !isNaN(parseInt(settings.cutWindowDays))
                ? Math.max(1, parseInt(settings.cutWindowDays)) : DEFAULT_SETTINGS.cutWindowDays,
            cutFallbackNumber: settings.cutFallbackNumber !== undefined ? String(settings.cutFallbackNumber).replace(/\D/g, '') : DEFAULT_SETTINGS.cutFallbackNumber,
            notifyNumbers: Array.isArray(settings.notifyNumbers) ? settings.notifyNumbers : DEFAULT_SETTINGS.notifyNumbers,
            pdfNotifyNumbers: Array.isArray(settings.pdfNotifyNumbers) ? settings.pdfNotifyNumbers : DEFAULT_SETTINGS.pdfNotifyNumbers,
            salesPdfNotifyNumbers: Array.isArray(settings.salesPdfNotifyNumbers) ? settings.salesPdfNotifyNumbers : DEFAULT_SETTINGS.salesPdfNotifyNumbers,
            filialGroups: typeof settings.filialGroups === 'object' ? settings.filialGroups : DEFAULT_SETTINGS.filialGroups,
            filialNumbers: typeof settings.filialNumbers === 'object' ? settings.filialNumbers : DEFAULT_SETTINGS.filialNumbers,
            rupturePisoEstoque: settings.rupturePisoEstoque !== undefined ? parseInt(settings.rupturePisoEstoque) : DEFAULT_SETTINGS.rupturePisoEstoque,
            ruptureJanelaGiro: settings.ruptureJanelaGiro !== undefined ? parseInt(settings.ruptureJanelaGiro) : DEFAULT_SETTINGS.ruptureJanelaGiro,
            ruptureMinDiasComVenda: settings.ruptureMinDiasComVenda !== undefined ? parseInt(settings.ruptureMinDiasComVenda) : DEFAULT_SETTINGS.ruptureMinDiasComVenda,
            ruptureJanelaVendaRecente: settings.ruptureJanelaVendaRecente !== undefined ? parseInt(settings.ruptureJanelaVendaRecente) : DEFAULT_SETTINGS.ruptureJanelaVendaRecente,
            ruptureCronTime: settings.ruptureCronTime || DEFAULT_SETTINGS.ruptureCronTime,
            ruptureNotifyNumbers: Array.isArray(settings.ruptureNotifyNumbers) ? settings.ruptureNotifyNumbers : DEFAULT_SETTINGS.ruptureNotifyNumbers,
            purchasingNotifyNumbers: Array.isArray(settings.purchasingNotifyNumbers) ? settings.purchasingNotifyNumbers : DEFAULT_SETTINGS.purchasingNotifyNumbers,
            purchasingCronTime: settings.purchasingCronTime || DEFAULT_SETTINGS.purchasingCronTime,
            purchasingLimiarAtencao: settings.purchasingLimiarAtencao !== undefined ? parseInt(settings.purchasingLimiarAtencao) : DEFAULT_SETTINGS.purchasingLimiarAtencao,
            pdfCronTime: settings.pdfCronTime || DEFAULT_SETTINGS.pdfCronTime,
            salesPdfCronTime: settings.salesPdfCronTime || DEFAULT_SETTINGS.salesPdfCronTime,
            newProductsCronTime: settings.newProductsCronTime || DEFAULT_SETTINGS.newProductsCronTime,
            supervisorCronTime: settings.supervisorCronTime || DEFAULT_SETTINGS.supervisorCronTime,
            personalizedProductsCronTime: settings.personalizedProductsCronTime || DEFAULT_SETTINGS.personalizedProductsCronTime,
            logisticsNotifyNumbers: settings.logisticsNotifyNumbers || DEFAULT_SETTINGS.logisticsNotifyNumbers,
            logisticsNotifyEmails: settings.logisticsNotifyEmails || DEFAULT_SETTINGS.logisticsNotifyEmails
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), 'utf8');
        logger.info('⚙️ Configurações salvas em settings.json');
        return true;
    } catch (err) {
        logger.error(`Erro ao salvar settings.json: ${err.message}`);
        return false;
    }
}

function getPollInterval() {
    return getSettings().pollIntervalMinutes;
}


function getNotifyNumbers() {
    try {
        const settings = getSettings();
        const contacts = contactsManager.getContacts();
        const activePhones = new Set(contacts.filter(c => c.phone).map(c => c.phone));
        return (settings.notifyNumbers || []).filter(phone => activePhones.has(phone));
    } catch (e) {
        logger.error(`Erro ao carregar notify numbers de contatos: ${e.message}`);
        return getSettings().notifyNumbers || [];
    }
}

function getGroupNameForFilial(codFilial) {
    const settings = getSettings();
    return settings.filialGroups[String(codFilial)] || null;
}

function getConfiguredFiliais() {
    const settings = getSettings();
    return Object.entries(settings.filialGroups)
        .filter(([_, name]) => name && name.trim() !== '')
        .map(([cod, name]) => ({ codFilial: cod, groupName: name }));
}

function getFilialNumbers(codFilial) {
    const filialStr = String(codFilial).trim();
    const isCombined = ['20', '6'].includes(filialStr);
    // UNIÃO de duas fontes (dedupe por dígitos): (1) vendedores sincronizados nos
    // contatos e (2) a lista curada mantida no painel (settings.filialNumbers).
    // Antes, o settings só era usado se o contactsManager falhasse — o que deixava a
    // lista curada (dezenas de números) órfã e quase ninguém era notificado.
    const result = new Set();

    // 1. Vendedores dos contatos (contacts.json)
    try {
        const contacts = contactsManager.getContacts();
        contacts.filter(c =>
            c.role === 'vendedor' &&
            c.phone &&
            (
                String(c.filial) === filialStr ||
                String(c.filial) === 'TODAS' ||
                (isCombined && ['20', '6'].includes(String(c.filial)))
            )
        ).forEach(c => {
            const p = String(c.phone).replace(/\D/g, '');
            if (p.length >= 8) result.add(p);
        });
    } catch (e) {
        logger.error(`Erro ao buscar vendedores da filial ${codFilial} dos contatos: ${e.message}`);
    }

    // 2. Lista curada em settings.filialNumbers (editada pelo painel)
    try {
        const settings = getSettings();
        let numbersStr = settings.filialNumbers?.[filialStr] || '';
        if (isCombined) {
            const s6 = settings.filialNumbers?.['6'] || '';
            const s20 = settings.filialNumbers?.['20'] || '';
            numbersStr = [s6, s20].filter(Boolean).join(', ');
        }
        numbersStr
            .split(/[\n,]+/)
            .map(n => n.trim().replace(/\D/g, ''))
            .filter(n => n.length >= 8)
            .forEach(n => result.add(n));
    } catch (e) {
        logger.error(`Erro ao ler settings.filialNumbers da filial ${codFilial}: ${e.message}`);
    }

    return Array.from(result);
}

function getPdfNotifyNumbers() {
    return getSettings().pdfNotifyNumbers || [];
}

function getSalesPdfNotifyNumbers() {
    return getSettings().salesPdfNotifyNumbers || ['5561983391951'];
}

/**
 * Obtém as configurações do arquivo .env
 */
function getEnvSettings() {
    return {
        oracleUser: process.env.ORACLE_USER || '',
        oraclePass: process.env.ORACLE_PASS || '',
        oracleConnectionString: process.env.ORACLE_CONNECTION_STRING || '',
        oracleClientDir: process.env.ORACLE_CLIENT_DIR || '',
        logLevel: process.env.LOG_LEVEL || 'info',
        smtpHost: process.env.SMTP_HOST || '',
        smtpPort: process.env.SMTP_PORT || '',
        smtpSecure: process.env.SMTP_SECURE || 'false',
        smtpUser: process.env.SMTP_USER || '',
        smtpPass: process.env.SMTP_PASS || '',
        emailTo: process.env.EMAIL_TO || '',
        googleSheetsWebappUrl: process.env.GOOGLE_SHEETS_WEBAPP_URL || '',
        googleSheetsViewUrl: process.env.GOOGLE_SHEETS_VIEW_URL || ''
    };
}

/**
 * Salva as configurações no arquivo .env
 */
function saveEnvSettings(envSettings) {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) {
        logger.error(`❌ Arquivo .env não encontrado em: ${envPath}`);
        return false;
    }
    
    try {
        let content = fs.readFileSync(envPath, 'utf8');
        
        for (const [key, value] of Object.entries(envSettings)) {
            if (value === undefined) continue;
            
            // Regex para encontrar a chave (com ou sem espaços, com ou sem comentários no final)
            const regex = new RegExp(`^(${key}\\s*=).*$`, 'm');
            if (regex.test(content)) {
                content = content.replace(regex, `$1${value}`);
            } else {
                // Se a chave não existir, adiciona no final
                content += `\n${key}=${value}`;
            }
            
            // Atualiza process.env na memória do processo atual
            process.env[key] = value;
        }
        
        fs.writeFileSync(envPath, content, 'utf8');
        logger.info('⚙️ Arquivo .env atualizado com sucesso.');
        return true;
    } catch (err) {
        logger.error(`Erro ao salvar arquivo .env: ${err.message}`);
        return false;
    }
}

function getRupturePisoEstoque() {
    return getSettings().rupturePisoEstoque;
}

function getRuptureJanelaGiro() {
    return getSettings().ruptureJanelaGiro;
}

function getRuptureMinDiasComVenda() {
    return getSettings().ruptureMinDiasComVenda;
}

function getRuptureJanelaVendaRecente() {
    return getSettings().ruptureJanelaVendaRecente;
}

function getRuptureCronTime() {
    return getSettings().ruptureCronTime;
}

function getRuptureNotifyNumbers() {
    const settings = getSettings();
    if (settings.ruptureNotifyNumbers && settings.ruptureNotifyNumbers.length > 0) {
        return settings.ruptureNotifyNumbers;
    }
    return getPdfNotifyNumbers();
}

function getPurchasingNotifyNumbers() {
    const settings = getSettings();
    if (settings.purchasingNotifyNumbers && settings.purchasingNotifyNumbers.length > 0) {
        return settings.purchasingNotifyNumbers;
    }
    return getPdfNotifyNumbers();
}

function getPurchasingCronTime() {
    return getSettings().purchasingCronTime;
}

function getPurchasingLimiarAtencao() {
    return getSettings().purchasingLimiarAtencao;
}

function getPdfCronTime() {
    return getSettings().pdfCronTime || DEFAULT_SETTINGS.pdfCronTime;
}

function getSalesPdfCronTime() {
    return getSettings().salesPdfCronTime || DEFAULT_SETTINGS.salesPdfCronTime;
}

function getNewProductsCronTime() {
    return getSettings().newProductsCronTime || DEFAULT_SETTINGS.newProductsCronTime;
}

function getSupervisorCronTime() {
    return getSettings().supervisorCronTime || DEFAULT_SETTINGS.supervisorCronTime;
}

function getPersonalizedProductsCronTime() {
    return getSettings().personalizedProductsCronTime || DEFAULT_SETTINGS.personalizedProductsCronTime;
}

module.exports = {
    getSettings,
    saveSettings,
    getPollInterval,
    getNotifyNumbers,
    getPdfNotifyNumbers,
    getSalesPdfNotifyNumbers,
    getGroupNameForFilial,
    getConfiguredFiliais,
    getFilialNumbers,
    getEnvSettings,
    saveEnvSettings,
    getRupturePisoEstoque,
    getRuptureJanelaGiro,
    getRuptureMinDiasComVenda,
    getRuptureJanelaVendaRecente,
    getRuptureCronTime,
    getRuptureNotifyNumbers,
    getPurchasingNotifyNumbers,
    getPurchasingCronTime,
    getPurchasingLimiarAtencao,
    getPdfCronTime,
    getSalesPdfCronTime,
    getNewProductsCronTime,
    getSupervisorCronTime,
    getPersonalizedProductsCronTime
};

