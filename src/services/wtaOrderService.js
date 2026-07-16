const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Lê e analisa a planilha de cotação
 * @param {string} filePath Caminho físico do arquivo excel (.xlsx)
 * @returns {Promise<Array<Object>>} Lista de itens da cotação mapeados
 */
async function parseQuoteExcel(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const ws = workbook.worksheets[0]; // Pega a primeira aba
    if (!ws) {
        throw new Error('Nenhuma planilha encontrada no arquivo.');
    }

    const items = [];
    let headerRowNumber = -1;
    let colIndices = {};

    // Mapeamento dos cabeçalhos esperados (normalizados para minúsculo e sem acentos/espaços)
    const expectedHeaders = {
        'ordem compra': 'ordem_compra',
        'item': 'item',
        'produto': 'produto',
        'codprod': 'codprod',
        'descricao': 'descricao',
        'um': 'um',
        'qtd': 'qtd',
        'valor unit.': 'valor_unit',
        'valor total': 'valor_total',
        'dt. entrega': 'dt_entrega',
        'centro custo': 'centro_custo',
        'codendereco': 'codendereco',
        'desc.cc': 'desc_cc'
    };

    // Função auxiliar para normalizar string
    const normalize = (str) => {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // remove acentos
            .replace(/\s+/g, ' ')            // normaliza espaços múltiplos
            .trim();
    };

    // 1. Acha a linha do cabeçalho
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (headerRowNumber !== -1) return;

        const rowValues = row.values.map(v => normalize(v));
        // Verifica se contém pelo menos alguns cabeçalhos críticos para identificar a linha correta
        const hasCodProd = rowValues.some(v => v.includes('codprod') || v === 'produto');
        const hasQtd = rowValues.some(v => v === 'qtd' || v.includes('quantidade'));

        if (hasCodProd && hasQtd) {
            headerRowNumber = rowNumber;
            // Mapeia o índice de cada coluna
            row.values.forEach((val, idx) => {
                const normVal = normalize(val);
                // Procura correspondência
                for (const [key, mapping] of Object.entries(expectedHeaders)) {
                    if (normVal === key || normVal.includes(key)) {
                        colIndices[mapping] = idx;
                    }
                }
            });
            logger.info(`Linha de cabeçalho identificada na linha ${headerRowNumber}. Índices das colunas mapeados.`);
        }
    });

    if (headerRowNumber === -1) {
        throw new Error('Não foi possível identificar o cabeçalho padrão da cotação na planilha.');
    }

    // 2. Lê as linhas de dados após o cabeçalho
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber <= headerRowNumber) return; // ignora cabeçalho e anteriores

        const getValue = (field) => {
            const idx = colIndices[field];
            if (!idx) return null;
            const cell = row.getCell(idx);
            // Se for fórmula, retorna o resultado
            return cell.result !== undefined ? cell.result : cell.value;
        };

        const item = {
            ordem_compra: getValue('ordem_compra'),
            item: getValue('item'),
            produto: getValue('produto'),
            codprod: parseInt(getValue('codprod'), 10),
            descricao: getValue('descricao'),
            um: getValue('um'),
            qtd: parseFloat(getValue('qtd')),
            valor_unit: parseFloat(getValue('valor_unit')),
            valor_total: parseFloat(getValue('valor_total')),
            dt_entrega: getValue('dt_entrega'),
            centro_custo: getValue('centro_custo'),
            codendereco: parseInt(getValue('codendereco'), 10),
            desc_cc: getValue('desc_cc'),
            rowNumber: rowNumber
        };

        // Só adiciona se tiver codprod e qtd válidos
        if (!isNaN(item.codprod) && !isNaN(item.qtd) && item.qtd > 0) {
            items.push(item);
        }
    });

    return items;
}

/**
 * Realiza a pré-validação dos itens de cotação consultando o banco Oracle
 * @param {Array<Object>} items Lista de itens obtida no parse da planilha
 * @param {number} codCli Código do cliente (ex: 55466)
 * @returns {Promise<Object>} Relatório completo de validação
 */
async function validateQuote(items, codCli) {
    let connection;
    const validatedItems = [];
    let hasErrors = false;

    try {
        connection = await getConnection();

        // 1. Carrega todos os endereços válidos do cliente na PCCLIENTENDENT
        const addrResult = await connection.execute(
            `SELECT CODENDENTCLI AS CODEND, ENDERENT AS ENDERECO, BAIRROENT AS BAIRRO, MUNICENT AS CIDADE, ESTENT AS ESTADO 
             FROM PCCLIENTENDENT 
             WHERE CODCLI = :codCli`,
            { codCli },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const validAddresses = new Map(addrResult.rows.map(r => [r.CODEND, r]));

        // 2. Para cada item da planilha, valida dados do WinThor
        for (const item of items) {
            const errors = [];
            const warnings = [];

            // A. Validação de Produto
            const prodResult = await connection.execute(
                `SELECT CODPROD, DESCRICAO, REVENDA, EMBALAGEM, UNIDADE 
                 FROM PCPRODUT 
                 WHERE CODPROD = :codprod`,
                { codprod: item.codprod },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            let prodInfo = null;
            if (prodResult.rows.length === 0) {
                errors.push(`Produto ${item.codprod} não encontrado no cadastro.`);
            } else {
                prodInfo = prodResult.rows[0];
                if (prodInfo.REVENDA !== 'S') {
                    warnings.push(`Produto ${item.codprod} não está marcado para REVENDA='S'.`);
                }
            }

            // B. Validação de Estoque
            let saldoDisponivel = 0;
            if (prodInfo) {
                const stockResult = await connection.execute(
                    `SELECT NVL(SUM(
                        NVL(QTESTGER, 0) - NVL(QTRESERV, 0) - NVL(QTINDENIZ, 0) - NVL(QTBLOQUEADA, 0)
                     ), 0) AS SALDO
                     FROM PCEST
                     WHERE CODPROD = :codprod`,
                    { codprod: item.codprod },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                saldoDisponivel = stockResult.rows[0].SALDO;
                
                if (saldoDisponivel < item.qtd) {
                    warnings.push(`Estoque insuficiente. Solicitado: ${item.qtd} | Disponível: ${saldoDisponivel}`);
                }
            }

            // C. Validação de Endereço de Entrega
            const addrInfo = validAddresses.get(item.codendereco);
            if (!item.codendereco) {
                errors.push('Código do endereço de entrega está em branco na planilha.');
            } else if (!addrInfo) {
                errors.push(`Código de endereço ${item.codendereco} não pertence ao cliente ${codCli}.`);
            }

            // D. Validação de Preço (Simples exemplo de divergência de tabela)
            let precoTabela = null;
            if (prodInfo) {
                // Buscamos o preço de tabela padrão da região do cliente
                const priceResult = await connection.execute(
                    `SELECT NVL(PVENDA, 0) AS PVENDA 
                     FROM PCTABPR 
                     WHERE CODPROD = :codprod AND NUMREGIAO = (
                         SELECT NUMREGIAOCLI FROM PCCLIENT WHERE CODCLI = :codCli
                     )`,
                    { codprod: item.codprod, codCli },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                if (priceResult.rows.length > 0) {
                    precoTabela = priceResult.rows[0].PVENDA;
                    const diffPct = Math.abs((item.valor_unit - precoTabela) / precoTabela) * 100;
                    if (diffPct > 0.01) {
                        warnings.push(`Preço cotação (R$ ${item.valor_unit.toFixed(2)}) difere do preço de tabela (R$ ${precoTabela.toFixed(2)}). Dif: ${diffPct.toFixed(1)}%`);
                    }
                }
            }

            if (errors.length > 0) {
                hasErrors = true;
            }

            validatedItems.push({
                ...item,
                errors,
                warnings,
                isValid: errors.length === 0,
                saldoDisponivel,
                precoTabela,
                enderecoDesc: addrInfo ? `${addrInfo.ENDERECO}, ${addrInfo.BAIRRO} - ${addrInfo.CIDADE}` : 'Não cadastrado'
            });
        }

        const totalItems = validatedItems.length;
        const validItemsCount = validatedItems.filter(i => i.isValid).length;
        const invalidItemsCount = totalItems - validItemsCount;

        return {
            hasErrors,
            totalItems,
            validItemsCount,
            invalidItemsCount,
            items: validatedItems
        };

    } catch (err) {
        logger.error(`Erro ao validar cotação no Oracle: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Envia ou simula o envio dos pedidos validados para a API do WTA agrupando-os por endereço de entrega
 * @param {Array<Object>} validatedItems Lista de itens de cotação pré-validados
 * @param {number} codCli Código do cliente (ex: 55466)
 * @param {number} codUsur RCA/Vendedor padrão do pedido
 * @returns {Promise<Object>} Relatório de criação dos pedidos
 */
async function submitToWTA(validatedItems, codCli, codUsur) {
    // 1. Agrupar itens por Código de Endereço de Entrega
    const grouped = {};
    for (const item of validatedItems) {
        if (!item.isValid) continue; // ignora itens inválidos
        if (!grouped[item.codendereco]) {
            grouped[item.codendereco] = [];
        }
        grouped[item.codendereco].push(item);
    }

    const wtaUrl = process.env.WTA_API_URL;
    const isProd = !!wtaUrl;
    
    const results = {
        success: true,
        integratedCount: 0,
        failedCount: 0,
        orders: []
    };

    logger.info(`Iniciando geração de pedidos no WTA para o cliente ${codCli}. Endereços únicos: ${Object.keys(grouped).length}`);

    // Para cada grupo (um pedido por endereço)
    for (const [codEnd, items] of Object.entries(grouped)) {
        const orderNumCli = items[0].ordem_compra || `OC-COT-${Date.now()}`;
        const dtEntrega = items[0].dt_entrega;
        const ccInfo = items[0].centro_custo ? `CC: ${items[0].centro_custo} - ${items[0].desc_cc || ''}` : '';

        // Monta o payload conforme padrão REST WinThor WTA
        const payload = {
            codCli: parseInt(codCli, 10),
            codUsur: parseInt(codUsur, 10),
            numPedCli: orderNumCli,
            dtEntrega: dtEntrega,
            observacao: `Importação automática cotação. ${ccInfo}`.substring(0, 100),
            itens: items.map(item => ({
                codProd: item.codprod,
                qt: item.qtd,
                pVenda: item.valor_unit,
                codEndEntCli: parseInt(codEnd, 10)
            }))
        };

        if (isProd) {
            try {
                throw new Error('Conexão ativa pendente de credenciais do WTA.');
            } catch (e) {
                logger.error(`[WTA API] Falha na integração do pedido para endereço ${codEnd}: ${e.message}`);
                results.failedCount++;
                results.orders.push({
                    codEnd: parseInt(codEnd, 10),
                    success: false,
                    error: e.message,
                    payload
                });
            }
        } else {
            // Modo SIMULAÇÃO / TESTE (Gera arquivos locais em scratch/wta_payloads)
            const simulatedNumPed = Math.floor(Math.random() * (999999 - 100000) + 100000);
            const scratchDir = path.join(__dirname, '..', '..', 'scratch', 'wta_payloads');
            
            if (!fs.existsSync(scratchDir)) {
                fs.mkdirSync(scratchDir, { recursive: true });
            }

            const payloadPath = path.join(scratchDir, `payload_simulado_cli_${codCli}_end_${codEnd}_${simulatedNumPed}.json`);
            fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf8');

            logger.info(`[SIMULAÇÃO WTA] Pedido gerado com sucesso. Número Simulado: ${simulatedNumPed}. Payload salvo em: ${payloadPath}`);
            results.integratedCount++;
            results.orders.push({
                codEnd: parseInt(codEnd, 10),
                success: true,
                numPed: simulatedNumPed,
                payloadPath,
                payload
            });
        }
    }

    if (results.failedCount > 0) {
        results.success = false;
    }

    return results;
}

module.exports = {
    parseQuoteExcel,
    validateQuote,
    submitToWTA
};
