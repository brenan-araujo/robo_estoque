-- =============================================================================
-- Relatório de Pedidos de Venda (cabeçalho) com coluna de Nota Fiscal
-- Base: WinThor (Oracle) - tabela principal PCPEDC
--
-- Coluna "Nota Fiscal":
--   - 'CANC'    -> pedido cancelado (P.DTCANCEL) OU nota cancelada (NF.DTCANCEL)
--   - (branco)  -> pedido não faturado (NVL(P.NUMNOTA,0) = 0)
--   - 'DEVOL'   -> devolução TOTAL da venda (valor devolvido >= valor faturado).
--                  Devolução parcial mantém o número da NF.
--   - número    -> NF de saída faturada normalmente
--
-- Vínculo com a NF: NF.NUMTRANSVENDA = P.NUMTRANSVENDA (validado como 1:1,
-- não duplica linhas mesmo nos raros pedidos com mais de uma NF).
-- Devolução tem DUAS fontes DISJUNTAS nesta base, ambas checadas por
-- NUMTRANSVENDA (colunas indexadas -> subquery correlacionada usa índice):
--   1) PCNFENT.NUMTRANSVENDAORIG (NF de entrada de devolução) - por valor
--   2) PCMOV.QTDEVOL nos movimentos de venda (CODOPER='S')     - por quantidade
-- Marca 'DEVOL' quando a devolução é TOTAL em qualquer uma das fontes.
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
    -- Nota fiscal: 'CANC' cancelado, 'DEVOL' devolução total, branco se não faturado
    CASE
        WHEN P.DTCANCEL IS NOT NULL OR NF.DTCANCEL IS NOT NULL THEN 'CANC'
        WHEN NVL(P.NUMNOTA, 0) = 0                              THEN NULL
        -- Devolução TOTAL via NF de entrada (PCNFENT): valor devolvido >= valor da NF
        WHEN NVL(NF.VLTOTAL, P.VLTOTAL) > 0
         AND (SELECT NVL(SUM(NE.VLTOTAL), 0)
                FROM PCNFENT NE
               WHERE NE.NUMTRANSVENDAORIG = P.NUMTRANSVENDA
                 AND NE.DTCANCEL IS NULL) >= NVL(NF.VLTOTAL, P.VLTOTAL) * 0.999
            THEN 'DEVOL'
        -- Devolução TOTAL via movimento (PCMOV.QTDEVOL): toda a qtd vendida foi devolvida
        WHEN EXISTS (
                SELECT 1
                  FROM PCMOV M
                 WHERE M.NUMTRANSVENDA = P.NUMTRANSVENDA
                   AND M.CODOPER = 'S'
                 GROUP BY M.NUMTRANSVENDA
                HAVING SUM(NVL(M.QTDEVOL, 0)) > 0
                   AND SUM(NVL(M.QTDEVOL, 0)) >= SUM(M.QT))
            THEN 'DEVOL'
        ELSE TO_CHAR(P.NUMNOTA)
    END                                                 AS "Nota Fiscal",
    -- Número da NF de devolução (vínculo: PCMOV.NUMTRANSDEV no mov. 'ED' +
    -- PCNFENT.NUMTRANSVENDAORIG). LISTAGG cobre o caso de mais de uma NF.
    (SELECT LISTAGG(NUM, ',') WITHIN GROUP (ORDER BY NUM)
       FROM (
            SELECT DISTINCT M.NUMNOTA AS NUM
              FROM PCMOV M
             WHERE M.NUMTRANSDEV = P.NUMTRANSVENDA
               AND M.CODOPER = 'ED'
            UNION
            SELECT DISTINCT NE.NUMNOTA AS NUM
              FROM PCNFENT NE
             WHERE NE.NUMTRANSVENDAORIG = P.NUMTRANSVENDA
               AND NE.DTCANCEL IS NULL
       ))                                               AS "NF Devolução",
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
ORDER BY
    P.DATA  DESC,
    P.NUMPED DESC
