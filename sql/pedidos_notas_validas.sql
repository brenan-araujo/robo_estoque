-- =============================================================================
-- Relatório de Pedidos de Venda — SOMENTE NOTAS VÁLIDAS
-- Base: WinThor (Oracle) - tabela principal PCPEDC
--
-- Variante de pedidos_notas_fiscais.sql que, em vez de marcar CANC/DEVOL,
-- REMOVE do resultado:
--   - notas canceladas  (pedido cancelado P.DTCANCEL ou NF cancelada NF.DTCANCEL)
--   - notas devolvidas (devolução TOTAL: por PCNFENT.VLTOTAL >= valor da NF
--                        OU por PCMOV.QTDEVOL = qtd vendida)
--
-- Mantém pedidos não faturados (sem nota) — não são cancelados nem devolvidos.
-- Para trazer SOMENTE faturados, descomente a linha "AND NVL(P.NUMNOTA,0) > 0".
--
-- Binds: :DT_INICIO, :DT_FIM (DD/MM/YYYY), :NUMPED, :CODCLI, :CODCLIPRINC, :NUMPEDCLI
-- Ver histórico de decisões em: pedidos_notas_fiscais_CONTEXTO.md
-- =============================================================================
SELECT
    -- Identificação
    P.CODFILIAL                                         AS "Filial de Emissão",
    P.CODCLI                                            AS "Cód. Cliente",
    C.CLIENTE                                           AS "Razão Social",
    P.NUMPED                                            AS "Número Pedido",
    -- Nota fiscal (em branco se ainda não faturado)
    CASE WHEN NVL(P.NUMNOTA, 0) = 0 THEN NULL ELSE P.NUMNOTA END
                                                        AS "Nota Fiscal",
    -- Valores
    P.VLTOTAL                                           AS "Valor Pedido",
    NVL(P.VLATEND, 0)                                   AS "Venda Líquida",
    -- Datas
    P.DATA                                              AS "Dt. Pedido",
    P.DTFAT                                             AS "Dt. Faturamento",
    CAR.DTFECHA                                         AS "Dt. Fechamento Carregamento",
    -- OC Cliente
    P.NUMPEDCLI                                         AS "Número OC Cliente",
    -- Endereço de entrega
    P.CODENDENTCLI                                      AS "Cód. Endereço Entrega",
    NVL(E.ENDERENT, C.ENDERCOM)                         AS "Endereço Entrega",
    -- Plano de pagamento
    P.CODPLPAG                                          AS "Código de Pagamento",
    PAG.DESCRICAO                                       AS "Plano de Pagamento",
    TRIM(TRIM('/' FROM REGEXP_REPLACE(
        NVL(TO_CHAR(PAG.PRAZO1),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO2),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO3),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO4),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO5),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO6),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO7),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO8),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO9),  '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO10), '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO11), '') || '/' ||
        NVL(TO_CHAR(PAG.PRAZO12), ''),
        '/{2,}', '/'
    )))                                                 AS "Prazos",
    -- Observações concatenadas (sem espaços duplos)
    TRIM(REGEXP_REPLACE(
        NVL(TRIM(P.OBS1),        '') || ' ' ||
        NVL(TRIM(P.OBS2),        '') || ' ' ||
        NVL(TRIM(P.OBSENTREGA1), '') || ' ' ||
        NVL(TRIM(P.OBSENTREGA2), '') || ' ' ||
        NVL(TRIM(P.OBSENTREGA3), ''),
        '\s{2,}', ' '
    ))                                                  AS "Observações"
FROM
         PCPEDC            P
    JOIN PCCLIENT           C   ON  C.CODCLI         = P.CODCLI
    LEFT JOIN PCCLIENTENDENT E   ON  E.CODCLI        = P.CODCLI
                                 AND E.CODENDENTCLI  = P.CODENDENTCLI
    LEFT JOIN PCPLPAG       PAG ON  PAG.CODPLPAG     = P.CODPLPAG
    LEFT JOIN PCCARREG      CAR ON  CAR.NUMCAR       = P.NUMCAR
    LEFT JOIN PCNFSAID      NF  ON  NF.NUMTRANSVENDA = P.NUMTRANSVENDA
WHERE
    P.DATA BETWEEN TO_DATE(:DT_INICIO, 'DD/MM/YYYY')
               AND TO_DATE(:DT_FIM,    'DD/MM/YYYY')
    AND (:NUMPED      IS NULL OR P.NUMPED      = :NUMPED)
    AND (:CODCLI      IS NULL OR P.CODCLI      = :CODCLI)
    AND (:CODCLIPRINC IS NULL OR C.CODCLIPRINC = :CODCLIPRINC)
    AND (:NUMPEDCLI IS NULL OR UPPER(P.NUMPEDCLI) LIKE '%' || UPPER(:NUMPEDCLI) || '%')
    -- >>> Filtros que removem canceladas e devolvidas <<<
    -- 1) Remove canceladas (pedido ou NF)
    AND P.DTCANCEL  IS NULL
    AND NF.DTCANCEL IS NULL
    -- 2) Remove devolução TOTAL via NF de entrada (PCNFENT)
    AND NOT (
        NVL(NF.VLTOTAL, P.VLTOTAL) > 0
        AND (SELECT NVL(SUM(NE.VLTOTAL), 0)
               FROM PCNFENT NE
              WHERE NE.NUMTRANSVENDAORIG = P.NUMTRANSVENDA
                AND NE.DTCANCEL IS NULL) >= NVL(NF.VLTOTAL, P.VLTOTAL) * 0.999
    )
    -- 3) Remove devolução TOTAL via movimento (PCMOV.QTDEVOL)
    AND NOT EXISTS (
        SELECT 1
          FROM PCMOV M
         WHERE M.NUMTRANSVENDA = P.NUMTRANSVENDA
           AND M.CODOPER = 'S'
         GROUP BY M.NUMTRANSVENDA
        HAVING SUM(NVL(M.QTDEVOL, 0)) > 0
           AND SUM(NVL(M.QTDEVOL, 0)) >= SUM(M.QT)
    )
    -- 4) (opcional) somente faturados: descomente a linha abaixo
    -- AND NVL(P.NUMNOTA, 0) > 0
ORDER BY
    P.DATA  DESC,
    P.NUMPED DESC
