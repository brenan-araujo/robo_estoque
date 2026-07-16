const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// CSV na raiz do projeto: "Código RCA;Nome Vendedor;Código Filial;Filial Formatada;Telefone 1;Telefone 2;Tel WhatsApp"
const CSV_PATH = path.resolve(__dirname, '..', '..', 'vendedores_telefones.csv');

let cache = null;      // { byPhone: Map<chave10, vendedor>, list: [...] }
let cacheMtimeMs = 0;

/**
 * Reduz um telefone a uma chave canônica de 10 dígitos: DDD + 8 dígitos finais.
 * Ignora país (55), o 9º dígito de celular, sufixos (@c.us/@lid) e formatação.
 * Retorna null se não der pra extrair um número BR plausível.
 */
function phoneKey(raw) {
    if (!raw) return null;
    let d = String(raw).replace(/@.*$/, '').replace(/\D/g, '');
    if (!d) return null;
    // Remove código do país
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 13 && d.startsWith('55')) d = d.slice(2); // 55 + DDD + 9 dígitos
    // Agora esperamos DDD(2) + 8 ou 9 dígitos
    if (d.length < 10) return null;
    const ddd = d.slice(0, 2);
    let num = d.slice(2);
    if (num.length === 9 && num.startsWith('9')) num = num.slice(1); // descarta 9º dígito
    num = num.slice(-8); // mantém os 8 finais
    if (num.length !== 8) return null;
    return ddd + num;
}

/** (Re)carrega o CSV se ainda não estiver em cache ou se o arquivo mudou. */
function load() {
    let mtimeMs = 0;
    try {
        mtimeMs = fs.statSync(CSV_PATH).mtimeMs;
    } catch (e) {
        logger.warn(`vendedores_telefones.csv não encontrado em ${CSV_PATH}`);
        cache = { byPhone: new Map(), list: [] };
        return cache;
    }
    if (cache && mtimeMs === cacheMtimeMs) return cache;

    const byPhone = new Map();
    const list = [];
    try {
        const raw = fs.readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, '');
        const lines = raw.split(/\r?\n/).filter((l) => l.trim());
        for (let i = 1; i < lines.length; i++) { // pula cabeçalho
            const cols = lines[i].split(';');
            if (cols.length < 7) continue;
            const vendedor = {
                rca: (cols[0] || '').trim(),
                nome: (cols[1] || '').trim(),
                codFilial: (cols[2] || '').trim(),
                filialFormatada: (cols[3] || '').trim(),
            };
            list.push(vendedor);
            // Indexa por todos os telefones da linha (Telefone 1, 2 e Tel WhatsApp)
            for (const tel of [cols[4], cols[5], cols[6]]) {
                const key = phoneKey(tel);
                if (key && !byPhone.has(key)) byPhone.set(key, vendedor);
            }
        }
        logger.info(`📇 vendedores_telefones.csv carregado: ${list.length} vendedores, ${byPhone.size} telefones indexados`);
    } catch (err) {
        logger.error(`Erro ao ler vendedores_telefones.csv: ${err.message}`);
    }

    cache = { byPhone, list };
    cacheMtimeMs = mtimeMs;
    return cache;
}

/**
 * Resolve o vendedor a partir de um telefone/JID do WhatsApp.
 * @param {string} phone - ex: "556199120613@c.us", "5561999120613" ou "61999120613"
 * @returns {{rca:string,nome:string,codFilial:string,filialFormatada:string}|null}
 */
function getVendedorByPhone(phone) {
    const key = phoneKey(phone);
    if (!key) return null;
    return load().byPhone.get(key) || null;
}

module.exports = { getVendedorByPhone, phoneKey };
