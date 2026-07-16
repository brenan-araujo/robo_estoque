const { getConnection, oracledb } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Retorna o início e o fim da semana desejada (Segunda a Sexta-Feira)
 * @param {number} weekOffset Deslocamento em semanas (0 para atual, 1 para a próxima)
 * @returns {Object} { startOfWeek, endOfWeek }
 */
function getCurrentWeekRange(weekOffset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0 = Domingo, 1 = Segunda, ...
    const diffToMon = day === 0 ? -6 : 1 - day;
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + diffToMon + (weekOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 4); // Segunda + 4 = Sexta-Feira
    endOfWeek.setHours(23, 59, 59, 999);

    return { startOfWeek, endOfWeek };
}

/**
 * Busca toda a carteira de produtos que estão para chegar (pedidos de compras pendentes)
 * e calcula os KPIs logísticos e alertas para a filial informada.
 * 
 * @param {string} filialCode Código da filial (ex: '20 + 6', '21', '22', '23')
 * @param {number} weekOffset Deslocamento em semanas (0 para atual, 1 para a próxima)
 * @returns {Promise<Object>} Dados processados contendo KPIs, itens da semana e carteira completa
 */
async function getLogisticsData(filialCode, weekOffset = 0) {
    let connection;
    try {
        connection = await getConnection();

        const isGeral = filialCode === 'GERAL' || filialCode === 'ALL';
        const isGroup20_6 = filialCode === '20 + 6' || filialCode === '20' || filialCode === '6';
        const filialGroupParam = isGeral ? 'GERAL' : (isGroup20_6 ? '20_6' : 'SINGLE');
        const filialParam = isGeral ? 'ALL' : (isGroup20_6 ? '20' : filialCode);

        // Query principal para obter todas as linhas pendentes
        const query = `
        SELECT 
            P.CODFILIAL,
            P.NUMPED,
            P.CODFORNEC,
            FORN.FANTASIA AS FORNECEDOR,
            I.CODPROD,
            PROD.DESCRICAO AS DESCRICAO_PRODUTO,
            P.DTPREVENT AS PREV_ENTREGA,
            (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) AS SALDO_PEDIDO,
            (
              SELECT NVL(SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0)), 0)
              FROM PCEST E
              WHERE E.CODPROD = I.CODPROD
                AND (
                  (P.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (P.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = P.CODFILIAL)
                )
            ) AS ESTOQUE_DISPONIVEL,
            (
              SELECT NVL(SUM(NVL(E.QTBLOQUEADA, 0)), 0)
              FROM PCEST E
              WHERE E.CODPROD = I.CODPROD
                AND (
                  (P.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (P.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = P.CODFILIAL)
                )
            ) AS ESTOQUE_BLOQUEADO,
            (
              SELECT NVL(MIN(CASE WHEN E.CODFILIAL = '20' THEN E.RUA END), MIN(E.RUA))
              FROM PCEST E
              WHERE E.CODPROD = I.CODPROD
                AND (
                  (P.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (P.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = P.CODFILIAL)
                )
            ) AS RUA,
            (
              SELECT NVL(MIN(CASE WHEN E.CODFILIAL = '20' THEN E.APTO END), MIN(E.APTO))
              FROM PCEST E
              WHERE E.CODPROD = I.CODPROD
                AND (
                  (P.CODFILIAL IN ('20', '6') AND E.CODFILIAL IN ('20', '6'))
                  OR
                  (P.CODFILIAL NOT IN ('20', '6') AND E.CODFILIAL = P.CODFILIAL)
                )
            ) AS APARTAMENTO,
            PROD.NUMERO,
            PROD.QTUNITCX,
            PROD.ALTURAM3,
            PROD.LARGURAM3,
            PROD.COMPRIMENTOM3
        FROM PCITEM I
        JOIN PCPEDIDO P ON I.NUMPED = P.NUMPED
        JOIN PCPRODUT PROD ON I.CODPROD = PROD.CODPROD
        LEFT JOIN PCFORNEC FORN ON P.CODFORNEC = FORN.CODFORNEC
        WHERE (I.QTPEDIDA - NVL(I.QTENTREGUE, 0)) > 0
          AND P.DTENTRADAESTOQUE IS NULL
          AND (
            (:filialGroupParam = '20_6' AND P.CODFILIAL IN ('20', '6'))
            OR
            (:filialGroupParam = 'SINGLE' AND P.CODFILIAL = :filialParam)
            OR
            (:filialGroupParam = 'GERAL')
          )
        ORDER BY P.DTPREVENT ASC, P.NUMPED ASC, I.CODPROD ASC
        `;

        const bindParams = {
            filialGroupParam,
            filialParam
        };

        logger.info(`Buscando dados logísticos para filial: ${filialCode}`);
        const result = await connection.execute(query, bindParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        // Pós-processamento dos dados
        const { startOfWeek, endOfWeek } = getCurrentWeekRange(weekOffset);
        
        const purchaseItems = result.rows.map(row => {
            const prevEntregaDate = row.PREV_ENTREGA ? new Date(row.PREV_ENTREGA) : null;
            const estoqueDisp = Number(row.ESTOQUE_DISPONIVEL) || 0;
            const estoqueBloq = Number(row.ESTOQUE_BLOQUEADO) || 0;
            const saldoPed = Number(row.SALDO_PEDIDO) || 0;
            const qtunitcx = Number(row.QTUNITCX) || 1;

            const alt = Number(row.ALTURAM3) || 0;
            const lar = Number(row.LARGURAM3) || 0;
            const comp = Number(row.COMPRIMENTOM3) || 0;
            
            // Cálculo real da cubagem da caixa master (de cm³ para m³)
            const cubagem = (alt > 0 && lar > 0 && comp > 0) ? (alt * lar * comp) / 1000000 : null;

            let isThisWeek = false;
            if (prevEntregaDate) {
                isThisWeek = prevEntregaDate >= startOfWeek && prevEntregaDate <= endOfWeek;
            }

            // Quantidade de embalagem master (caixas)
            const qtdEmbMaster = Math.round((saldoPed / qtunitcx) * 100) / 100;

            return {
                CODIGO_FORNECEDOR: Number(row.CODFORNEC) || 0,
                FORNECEDOR: row.FORNECEDOR || 'SEM FORNECEDOR',
                CODIGO_PRODUTO: Number(row.CODPROD) || 0,
                DESCRICAO_PRODUTO: row.DESCRICAO_PRODUTO || '',
                ESTOQUE_DISPONIVEL: estoqueDisp,
                ESTOQUE_BLOQUEADO: estoqueBloq,
                SALDO_PEDIDO: saldoPed,
                CUBAGEM_CAIXA: cubagem,
                QTD_EMB_MASTER: qtdEmbMaster,
                PREV_ENTREGA: prevEntregaDate,
                RUA: row.RUA !== null && row.RUA !== undefined ? String(row.RUA) : '',
                PREDIO: row.NUMERO !== null && row.NUMERO !== undefined ? String(row.NUMERO) : '',
                APARTAMENTO: row.APARTAMENTO !== null && row.APARTAMENTO !== undefined ? String(row.APARTAMENTO) : '',
                NUMPED: row.NUMPED,
                CODFILIAL: row.CODFILIAL,
                isThisWeek
            };
        });

        // Buscar transferências inter-filiais em trânsito integradas
        let transferItems = [];
        try {
            let transferClientClause;
            let transferBindParams = {};
            if (isGeral) {
                transferClientClause = `T.CODCLI IN (44487, 31992, 44775, 44577, 44575)`;
            } else if (isGroup20_6) {
                transferClientClause = `T.CODCLI IN (44487, 31992)`;
            } else {
                const clientMap = {
                    '21': 44775,
                    '22': 44577,
                    '23': 44575,
                    '20': 44487,
                    '6': 31992
                };
                const targetClient = clientMap[String(filialCode)];
                if (targetClient) {
                    transferClientClause = `T.CODCLI = :transferClient`;
                    transferBindParams.transferClient = targetClient;
                } else {
                    transferClientClause = `1=0`;
                }
            }

            const transferQuery = `
            SELECT 
                T.NUMNOTA,
                T.NUMTRANSVENDA,
                T.CODFILIAL AS FILIAL_ORIGEM,
                FIL.FANTASIA AS FORNECEDOR,
                FIL.CODFORNEC AS CODFORNEC,
                T.CODCLI AS CODCLI_DESTINO,
                T.DTSAIDA AS PREV_ENTREGA,
                M.CODPROD,
                P.DESCRICAO AS DESCRICAO_PRODUTO,
                M.QT AS SALDO_PEDIDO,
                P.QTUNITCX,
                P.ALTURAM3,
                P.LARGURAM3,
                P.COMPRIMENTOM3,
                -- Estoque disponível no destino
                (
                  SELECT NVL(SUM(NVL(E.QTESTGER, 0) - NVL(E.QTRESERV, 0) - NVL(E.QTBLOQUEADA, 0)), 0)
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                    AND (
                      (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                         CASE 
                            WHEN T.CODCLI = 44775 THEN '21'
                            WHEN T.CODCLI = 44577 THEN '22'
                            WHEN T.CODCLI = 44575 THEN '23'
                         END
                      )
                    )
                ) AS ESTOQUE_DISPONIVEL,
                -- Estoque bloqueado no destino
                (
                  SELECT NVL(SUM(NVL(E.QTBLOQUEADA, 0)), 0)
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                    AND (
                      (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                         CASE 
                            WHEN T.CODCLI = 44775 THEN '21'
                            WHEN T.CODCLI = 44577 THEN '22'
                            WHEN T.CODCLI = 44575 THEN '23'
                         END
                      )
                    )
                ) AS ESTOQUE_BLOQUEADO,
                -- RUA no destino
                (
                  SELECT NVL(MIN(CASE WHEN E.CODFILIAL = '20' THEN E.RUA END), MIN(E.RUA))
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                    AND (
                      (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                         CASE 
                            WHEN T.CODCLI = 44775 THEN '21'
                            WHEN T.CODCLI = 44577 THEN '22'
                            WHEN T.CODCLI = 44575 THEN '23'
                         END
                      )
                    )
                ) AS RUA,
                -- APTO no destino
                (
                  SELECT NVL(MIN(CASE WHEN E.CODFILIAL = '20' THEN E.APTO END), MIN(E.APTO))
                  FROM PCEST E
                  WHERE E.CODPROD = M.CODPROD
                    AND (
                      (T.CODCLI IN (44487, 31992) AND E.CODFILIAL IN ('20', '6'))
                      OR
                      (T.CODCLI NOT IN (44487, 31992) AND E.CODFILIAL = 
                         CASE 
                            WHEN T.CODCLI = 44775 THEN '21'
                            WHEN T.CODCLI = 44577 THEN '22'
                            WHEN T.CODCLI = 44575 THEN '23'
                         END
                      )
                    )
                ) AS APARTAMENTO,
                P.NUMERO AS PREDIO
            FROM PCNFSAID T
            JOIN PCMOV M ON M.NUMTRANSVENDA = T.NUMTRANSVENDA AND M.CODOPER = 'S'
            JOIN PCPRODUT P ON M.CODPROD = P.CODPROD
            JOIN PCFILIAL FIL ON FIL.CODIGO = T.CODFILIAL
            LEFT JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
            WHERE T.DTCANCEL IS NULL
              AND E.NUMTRANSENT IS NULL
              AND T.CODFILIAL IN ('20', '6', '21', '22', '23')
              AND ${transferClientClause}
              AND T.DTSAIDA >= SYSDATE - 180
              AND NOT (
                  (T.CODFILIAL IN ('20', '6') AND T.CODCLI IN (44487, 31992))
                  OR (T.CODFILIAL = '21' AND T.CODCLI = 44775)
                  OR (T.CODFILIAL = '22' AND T.CODCLI = 44577)
                  OR (T.CODFILIAL = '23' AND T.CODCLI = 44575)
              )
            ORDER BY T.DTSAIDA DESC
            `;

            logger.info(`Buscando transferências em trânsito integradas para filial destino: ${filialCode}`);
            const tResult = await connection.execute(transferQuery, transferBindParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            
            const clientToFilialMap = {
                '44487': '20',
                '31992': '6',
                '44775': '21',
                '44577': '22',
                '44575': '23'
            };

            transferItems = tResult.rows.map(row => {
                const dtsaida = row.PREV_ENTREGA ? new Date(row.PREV_ENTREGA) : null;
                let prevEntregaDate = null;
                if (dtsaida) {
                    prevEntregaDate = new Date(dtsaida);
                    prevEntregaDate.setDate(dtsaida.getDate() + 3); // faturamento + 3 dias de trânsito
                }

                const estoqueDisp = Number(row.ESTOQUE_DISPONIVEL) || 0;
                const estoqueBloq = Number(row.ESTOQUE_BLOQUEADO) || 0;
                const saldoPed = Number(row.SALDO_PEDIDO) || 0;
                const qtunitcx = Number(row.QTUNITCX) || 1;

                const alt = Number(row.ALTURAM3) || 0;
                const lar = Number(row.LARGURAM3) || 0;
                const comp = Number(row.COMPRIMENTOM3) || 0;
                
                const cubagem = (alt > 0 && lar > 0 && comp > 0) ? (alt * lar * comp) / 1000000 : null;

                let isThisWeek = false;
                if (prevEntregaDate) {
                    isThisWeek = prevEntregaDate >= startOfWeek && prevEntregaDate <= endOfWeek;
                }

                const qtdEmbMaster = Math.round((saldoPed / qtunitcx) * 100) / 100;
                const destFilial = clientToFilialMap[String(row.CODCLI_DESTINO)] || row.CODCLI_DESTINO;
                const fornecedorText = `TRANSF - ${row.FORNECEDOR}`;

                return {
                    CODIGO_FORNECEDOR: Number(row.CODFORNEC) || 0,
                    FORNECEDOR: fornecedorText,
                    CODIGO_PRODUTO: Number(row.CODPROD) || 0,
                    DESCRICAO_PRODUTO: row.DESCRICAO_PRODUTO || '',
                    ESTOQUE_DISPONIVEL: estoqueDisp,
                    ESTOQUE_BLOQUEADO: estoqueBloq,
                    SALDO_PEDIDO: saldoPed,
                    CUBAGEM_CAIXA: cubagem,
                    QTD_EMB_MASTER: qtdEmbMaster,
                    PREV_ENTREGA: prevEntregaDate,
                    RUA: row.RUA !== null && row.RUA !== undefined ? String(row.RUA) : '',
                    PREDIO: row.PREDIO !== null && row.PREDIO !== undefined ? String(row.PREDIO) : '',
                    APARTAMENTO: row.APARTAMENTO !== null && row.APARTAMENTO !== undefined ? String(row.APARTAMENTO) : '',
                    NUMPED: row.NUMNOTA,
                    CODFILIAL: destFilial,
                    isThisWeek
                };
            });
            logger.info(`✅ ${transferItems.length} itens de transferência em trânsito integrados com sucesso.`);
        } catch (transErr) {
            logger.error(`Erro ao integrar transferências em trânsito: ${transErr.message}`);
        }

        const allItems = [...purchaseItems, ...transferItems];

        // 1. Filtrar itens da semana
        const weekItems = allItems.filter(item => item.isThisWeek);

        // 2. Calcular KPIs para a Semana Corrente
        const totalPedidosSemana = new Set(weekItems.map(item => item.NUMPED)).size;
        const totalItensSemana = weekItems.reduce((acc, item) => acc + item.SALDO_PEDIDO, 0);
        const totalCaixasSemana = weekItems.reduce((acc, item) => acc + (item.QTD_EMB_MASTER || 0), 0);
        const totalVolumeSemana = weekItems.reduce((acc, item) => acc + (item.CUBAGEM_CAIXA || 0) * (item.QTD_EMB_MASTER || 0), 0);

        // 3. Alertas Logísticos da Semana
        // A. Urgência de Recebimento (Estoque Zero ou Negativo)
        const urgenciaRecebimento = weekItems.filter(item => item.ESTOQUE_DISPONIVEL <= 0);

        // B. Alerta de Cadastro (Produtos Sem Endereço - Rua/Apto vazio ou com 99 / 0 / 00 / 999)
        const isUnaddrVal = (val) => {
            const v = String(val || '').trim();
            return !v || v === '0' || v === '00' || v === '99' || v === '999' || v === '9999';
        };
        const semEndereco = weekItems.filter(item => isUnaddrVal(item.RUA) || isUnaddrVal(item.APARTAMENTO));

        // 4. Cronograma Diário (Segunda a Sexta) - Agrupado por Dia e Fornecedor
        const cronogramaDiario = {
            'Segunda-Feira': {},
            'Terça-Feira': {},
            'Quarta-Feira': {},
            'Quinta-Feira': {},
            'Sexta-Feira': {}
        };

        const diasSemanaNomes = ['Domingo', 'Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado'];

        weekItems.forEach(item => {
            if (item.PREV_ENTREGA) {
                const dayIndex = item.PREV_ENTREGA.getDay();
                const diaNome = diasSemanaNomes[dayIndex];
                if (cronogramaDiario[diaNome]) {
                    const isGeralReport = filialCode === 'GERAL' || filialCode === 'ALL';
                    const ufSuffix = item.CODFILIAL === '20' || item.CODFILIAL === '6' ? 'DF' : item.CODFILIAL === '21' ? 'GO' : item.CODFILIAL === '22' ? 'TO' : item.CODFILIAL === '23' ? 'MS' : item.CODFILIAL;
                    const forn = isGeralReport ? `${item.FORNECEDOR} (${ufSuffix})` : item.FORNECEDOR;
                    
                    if (!cronogramaDiario[diaNome][forn]) {
                        cronogramaDiario[diaNome][forn] = { itens: 0, caixas: 0, volumeM3: 0 };
                    }
                    cronogramaDiario[diaNome][forn].itens += item.SALDO_PEDIDO;
                    cronogramaDiario[diaNome][forn].caixas += item.QTD_EMB_MASTER || 0;
                    cronogramaDiario[diaNome][forn].volumeM3 += (item.CUBAGEM_CAIXA || 0) * (item.QTD_EMB_MASTER || 0);
                }
            }
        });

        // Converter para Array de linhas repetindo os dias da semana
        const cronogramaFinal = [];
        const diasOrdenados = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira'];
        diasOrdenados.forEach(dia => {
            const suppliers = Object.keys(cronogramaDiario[dia]);
            if (suppliers.length === 0) {
                cronogramaFinal.push({
                    dia,
                    fornecedor: '—',
                    itens: 0,
                    caixas: 0,
                    volumeM3: 0
                });
            } else {
                let dayItens = 0;
                let dayCaixas = 0;
                let dayVolume = 0;

                suppliers.forEach(forn => {
                    const data = cronogramaDiario[dia][forn];
                    cronogramaFinal.push({
                        dia,
                        fornecedor: forn,
                        itens: Math.round(data.itens * 100) / 100,
                        caixas: Math.round(data.caixas * 100) / 100,
                        volumeM3: Math.round(data.volumeM3 * 1000) / 1000
                    });
                    dayItens += data.itens;
                    dayCaixas += data.caixas;
                    dayVolume += data.volumeM3;
                });

                // Adicionar linha de subtotal para o dia
                cronogramaFinal.push({
                    dia,
                    fornecedor: `Total do Dia (${suppliers.length} forn.)`,
                    itens: Math.round(dayItens * 100) / 100,
                    caixas: Math.round(dayCaixas * 100) / 100,
                    volumeM3: Math.round(dayVolume * 1000) / 1000,
                    isSubtotal: true
                });
            }
        });

        // 5. Top Fornecedores da Semana
        const fornMap = {};
        weekItems.forEach(item => {
            if (!fornMap[item.FORNECEDOR]) {
                fornMap[item.FORNECEDOR] = { 
                    fornecedor: item.FORNECEDOR, 
                    pedidos: new Set(), 
                    itens: 0, 
                    caixas: 0, 
                    volumeM3: 0 
                };
            }
            fornMap[item.FORNECEDOR].pedidos.add(item.NUMPED);
            fornMap[item.FORNECEDOR].itens += item.SALDO_PEDIDO;
            fornMap[item.FORNECEDOR].caixas += item.QTD_EMB_MASTER || 0;
            fornMap[item.FORNECEDOR].volumeM3 += (item.CUBAGEM_CAIXA || 0) * (item.QTD_EMB_MASTER || 0);
        });

        const topFornecedores = Object.values(fornMap)
            .map(f => ({
                fornecedor: f.fornecedor,
                pedidos: f.pedidos.size,
                itens: Math.round(f.itens * 100) / 100,
                caixas: Math.round(f.caixas * 100) / 100,
                volumeM3: Math.round(f.volumeM3 * 1000) / 1000
            }))
            .sort((a, b) => b.itens - a.itens) // Ordenado por itens para bater com o mock
            .slice(0, 5);

        return {
            filialCode,
            startOfWeek,
            endOfWeek,
            kpis: {
                totalPedidosSemana,
                totalItensSemana: Math.round(totalItensSemana * 100) / 100,
                totalCaixasSemana: Math.round(totalCaixasSemana * 100) / 100,
                totalVolumeSemana: Math.round(totalVolumeSemana * 1000) / 1000,
                totalUrgentes: urgenciaRecebimento.length,
                totalSemEndereco: semEndereco.length
            },
            cronograma: cronogramaFinal,
            topFornecedores,
            alertas: {
                urgenciaRecebimento: urgenciaRecebimento.map(item => ({
                    CODIGO_PRODUTO: item.CODIGO_PRODUTO,
                    DESCRICAO_PRODUTO: item.DESCRICAO_PRODUTO,
                    FORNECEDOR: item.FORNECEDOR,
                    SALDO_PEDIDO: item.SALDO_PEDIDO,
                    ESTOQUE_DISPONIVEL: item.ESTOQUE_DISPONIVEL,
                    ESTOQUE_BLOQUEADO: item.ESTOQUE_BLOQUEADO,
                    CUBAGEM_CAIXA: item.CUBAGEM_CAIXA,
                    QTD_EMB_MASTER: item.QTD_EMB_MASTER,
                    PREV_ENTREGA: item.PREV_ENTREGA,
                    RUA: item.RUA,
                    PREDIO: item.PREDIO,
                    APARTAMENTO: item.APARTAMENTO,
                    CODFILIAL: item.CODFILIAL
                })),
                semEndereco: semEndereco.map(item => ({
                    CODIGO_PRODUTO: item.CODIGO_PRODUTO,
                    DESCRICAO_PRODUTO: item.DESCRICAO_PRODUTO,
                    FORNECEDOR: item.FORNECEDOR,
                    SALDO_PEDIDO: item.SALDO_PEDIDO,
                    ESTOQUE_DISPONIVEL: item.ESTOQUE_DISPONIVEL,
                    ESTOQUE_BLOQUEADO: item.ESTOQUE_BLOQUEADO,
                    CUBAGEM_CAIXA: item.CUBAGEM_CAIXA,
                    QTD_EMB_MASTER: item.QTD_EMB_MASTER,
                    PREV_ENTREGA: item.PREV_ENTREGA,
                    RUA: item.RUA,
                    PREDIO: item.PREDIO,
                    APARTAMENTO: item.APARTAMENTO,
                    CODFILIAL: item.CODFILIAL
                }))
            },
            weekItems,
            allItems
        };

    } catch (err) {
        logger.error(`Erro ao buscar dados logísticos: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

/**
 * Busca as transferências entre filiais que estão em trânsito
 * (faturadas na origem mas ainda não recebidas no destino).
 *
 * @param {string} filialCode Código da filial de DESTINO (ex: '20', '6', '21', '22', '23', '20 + 6', 'GERAL')
 * @returns {Promise<Array>} Array de transferências em trânsito
 */
async function getInterBranchTransfers(filialCode) {
    let connection;
    try {
        connection = await getConnection();

        const isGeral = filialCode === 'GERAL' || filialCode === 'ALL';
        const isGroup20_6 = filialCode === '20 + 6' || filialCode === '20' || filialCode === '6';

        let transferClientClause;
        let bindParams = {};

        if (isGeral) {
            transferClientClause = `T.CODCLI IN (44487, 31992, 44775, 44577, 44575)`;
        } else if (isGroup20_6) {
            transferClientClause = `T.CODCLI IN (44487, 31992)`;
        } else {
            const clientMap = {
                '21': 44775,
                '22': 44577,
                '23': 44575,
                '20': 44487,
                '6': 31992
            };
            const targetClient = clientMap[String(filialCode)];
            if (targetClient) {
                transferClientClause = `T.CODCLI = :transferClient`;
                bindParams.transferClient = targetClient;
            } else {
                transferClientClause = `1=0`;
            }
        }

        const query = `
        SELECT
            T.NUMTRANSVENDA,
            T.CODFILIAL AS CODFILIALORIGEM,
            CASE 
                WHEN T.CODCLI = 44487 THEN '20'
                WHEN T.CODCLI = 31992 THEN '6'
                WHEN T.CODCLI = 44775 THEN '21'
                WHEN T.CODCLI = 44577 THEN '22'
                WHEN T.CODCLI = 44575 THEN '23'
            END AS CODFILIALDESTINO,
            M.CODPROD,
            P.DESCRICAO AS DESCRICAO_PRODUTO,
            M.QT AS QTTRANSF,
            T.DTSAIDA AS DTTRANSF,
            P.QTUNITCX,
            P.ALTURAM3,
            P.LARGURAM3,
            P.COMPRIMENTOM3
        FROM PCNFSAID T
        JOIN PCMOV M ON M.NUMTRANSVENDA = T.NUMTRANSVENDA AND M.CODOPER = 'S'
        JOIN PCPRODUT P ON M.CODPROD = P.CODPROD
        LEFT JOIN PCNFENT E ON E.NUMTRANSVENDAORIG = T.NUMTRANSVENDA AND E.DTCANCEL IS NULL
        WHERE T.DTCANCEL IS NULL
          AND E.NUMTRANSENT IS NULL
          AND T.CODFILIAL IN ('20', '6', '21', '22', '23')
          AND ${transferClientClause}
          AND T.DTSAIDA >= SYSDATE - 180
          AND NOT (
              (T.CODFILIAL IN ('20', '6') AND T.CODCLI IN (44487, 31992))
              OR (T.CODFILIAL = '21' AND T.CODCLI = 44775)
              OR (T.CODFILIAL = '22' AND T.CODCLI = 44577)
              OR (T.CODFILIAL = '23' AND T.CODCLI = 44575)
          )
        ORDER BY T.DTSAIDA ASC, T.NUMTRANSVENDA ASC, M.CODPROD ASC
        `;

        logger.info(`Buscando transferências em trânsito para filial destino: ${filialCode}`);
        const result = await connection.execute(query, bindParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const transfers = result.rows.map(row => {
            const dtTransf = row.DTTRANSF ? new Date(row.DTTRANSF) : null;
            const diasEmTransito = dtTransf
                ? Math.floor((today - dtTransf) / (1000 * 60 * 60 * 24))
                : null;

            const qtUnitcx = Number(row.QTUNITCX) || 1;
            const qttransf = Number(row.QTTRANSF) || 0;
            const qtdCaixas = Math.round((qttransf / qtUnitcx) * 100) / 100;

            const alt = Number(row.ALTURAM3) || 0;
            const lar = Number(row.LARGURAM3) || 0;
            const comp = Number(row.COMPRIMENTOM3) || 0;
            const cubagemCaixa = (alt > 0 && lar > 0 && comp > 0) ? (alt * lar * comp) / 1000000 : null;
            const cubagemTotal = cubagemCaixa !== null ? cubagemCaixa * qtdCaixas : null;

            return {
                NUMTRANSVENDA: row.NUMTRANSVENDA,
                CODFILIALORIGEM: row.CODFILIALORIGEM,
                CODFILIALDESTINO: row.CODFILIALDESTINO,
                CODIGO_PRODUTO: Number(row.CODPROD) || 0,
                DESCRICAO_PRODUTO: row.DESCRICAO_PRODUTO || '',
                QTTRANSF: qttransf,
                QTD_CAIXAS: qtdCaixas,
                CUBAGEM_CAIXA: cubagemCaixa,
                CUBAGEM_TOTAL: cubagemTotal,
                DTTRANSF: dtTransf,
                DIAS_EM_TRANSITO: diasEmTransito !== null ? Math.max(0, diasEmTransito) : null
            };
        });

        return transfers;

    } catch (err) {
        logger.error(`Erro ao buscar transferências em trânsito: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

/**
 * Busca todos os produtos ativos (DTEXCLUSAO IS NULL) e de revenda (REVENDA = 'S')
 * que possuem dimensões nulas ou zeradas (ALTURAM3, LARGURAM3 ou COMPRIMENTOM3),
 * trazendo também as informações de estoque na filial 20.
 *
 * @returns {Promise<Array>} Lista de produtos
 */
async function getProductsWithoutCubage() {
    let connection;
    try {
        connection = await getConnection();
        const query = `
            SELECT 
                P.CODPROD,
                P.DESCRICAO,
                P.QTUNITCX,
                P.CODFORNEC,
                (SELECT FANTASIA FROM PCFORNEC WHERE CODFORNEC = P.CODFORNEC) AS FORNECEDOR,
                P.ALTURAM3,
                P.LARGURAM3,
                P.COMPRIMENTOM3,
                NVL((SELECT QTESTGER FROM PCEST WHERE CODPROD = P.CODPROD AND CODFILIAL = '20'), 0) AS ESTOQUE_20,
                NVL((SELECT QTESTGER - QTRESERV - QTBLOQUEADA FROM PCEST WHERE CODPROD = P.CODPROD AND CODFILIAL = '20'), 0) AS ESTOQUE_DISP_20
            FROM PCPRODUT P
            WHERE P.DTEXCLUSAO IS NULL
              AND P.REVENDA = 'S'
              AND P.CODEPTO NOT IN (6, 103)
              AND (
                  (P.ALTURAM3 IS NULL OR P.ALTURAM3 = 0
                   OR P.LARGURAM3 IS NULL OR P.LARGURAM3 = 0
                   OR P.COMPRIMENTOM3 IS NULL OR P.COMPRIMENTOM3 = 0)
                  OR P.CODFORNEC = 13232
              )
            ORDER BY P.CODFORNEC ASC, P.CODPROD ASC
        `;
        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = result.rows || [];
        
        const softWorksRules = {
            'BB50': ['BRANCO', 'PRETO'],
            'BB51': ['BRANCO', 'PRETO'],
            'BB60': ['BRANCO', 'MARINHO', 'PRETO', 'ROSA BEBE'],
            'BB61': ['BRANCO', 'PRETO'],
            'BB65': ['BRANCO', 'PRETO'],
            'BB66': ['BRANCO', 'PRETO'],
            'BB67': ['BRANCO', 'PRETO'],
            'BB80': ['AMEIXA', 'BRANCO', 'BRANCO 2', 'MARINHO', 'PRETO', 'PRETO 2'],
            'BB81': ['BRANCO2', 'MARINHO', 'PRETO', 'PRETO2'],
            'BB85': ['BRANCO', 'PRETO'],
            'BB86': ['BRANCO', 'PRETO'],
            'BB87': ['BRANCO', 'PRETO'],
            'BB95': ['BRANCO', 'PRETO']
        };

        function matchesSoftWorksRules(description) {
            const desc = description.toUpperCase();
            
            let matchedModel = null;
            for (const model of Object.keys(softWorksRules)) {
                if (desc.includes(model)) {
                    matchedModel = model;
                    break;
                }
            }
            if (!matchedModel) return false;
            
            let color = null;
            if (desc.includes('BCO2') || desc.includes('BCO 2') || desc.includes('BRANCO2') || desc.includes('BRANCO 2')) {
                color = 'BRANCO 2';
            } else if (desc.includes('PTO2') || desc.includes('PTO 2') || desc.includes('PRETO2') || desc.includes('PRETO 2')) {
                color = 'PRETO 2';
            } else if (desc.includes('BCO') || desc.includes('BRANCO') || desc.includes('WHITE')) {
                color = 'BRANCO';
            } else if (desc.includes('PTO') || desc.includes('PRETO') || desc.includes('PT') || desc.includes('BLACK')) {
                color = 'PRETO';
            } else if (desc.includes('MRN') || desc.includes('MARINHO') || desc.includes('NAVY')) {
                color = 'MARINHO';
            } else if (desc.includes('ROSA') || desc.includes('PINK')) {
                color = 'ROSA BEBE';
            } else if (desc.includes('AMEIXA') || desc.includes('AMX') || desc.includes('PLUM')) {
                color = 'AMEIXA';
            }
            if (!color) return false;
            
            const allowed = softWorksRules[matchedModel];
            const cleanColor = color.replace(/\s+/g, '');
            return allowed.some(ac => ac.replace(/\s+/g, '') === cleanColor);
        }

        const filteredRows = rows.filter(p => {
            const hasZeroDim = p.ALTURAM3 === null || p.ALTURAM3 === 0 ||
                               p.LARGURAM3 === null || p.LARGURAM3 === 0 ||
                               p.COMPRIMENTOM3 === null || p.COMPRIMENTOM3 === 0;
                               
            if (hasZeroDim) return true;
            
            if (p.CODFORNEC === 13232) {
                return matchesSoftWorksRules(p.DESCRICAO);
            }
            
            return false;
        });
        
        return filteredRows;
    } catch (err) {
        logger.error(`Erro ao buscar produtos sem cubagem: ${err.message}`);
        throw err;
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

module.exports = {
    getLogisticsData,
    getCurrentWeekRange,
    getInterBranchTransfers,
    getProductsWithoutCubage
};
