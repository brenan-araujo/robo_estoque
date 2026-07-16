SELECT
    "Fornecedor",
    "Cód Forn.",
    "Filial",
    "Cód Prod.",
    "Produto",
    "NCM",
    "Estoque",
    "Situação Estoque",
    "O Que Resolver",
    "Cód Trib.",
    "Msg Tributação"
FROM (
    SELECT
        NVL(X.NOME_FORNECEDOR, 'NÃO IDENTIFICADO')            AS "Fornecedor",
        X.CODFORNEC                                           AS "Cód Forn.",
        NVL(X.NOME_FILIAL, 'FILIAL ' || X.CODFILIAL)          AS "Filial",
        X.CODPROD                                             AS "Cód Prod.",
        X.DESCRICAO                                           AS "Produto",
        X.NCM                                                 AS "NCM",
        ROUND(X.QT_DISPONIVEL, 2)                             AS "Estoque",
        CASE WHEN X.SITUACAO_ESTOQUE = 'COM_ESTOQUE'
             THEN 'COM ESTOQUE' ELSE 'SEM ESTOQUE' END        AS "Situação Estoque",
        NVL(NULLIF(RTRIM(X.MOTIVOS_PENDENCIA, ' |'), ''),
            'Revisar cadastro (custo de reposição / flag ION)') AS "O Que Resolver",
        X.COD_TRIB_271                                        AS "Cód Trib.",
        X.MSG_TRIBUTACAO                                      AS "Msg Tributação",
        X.STATUS_INTEGRACAO
    FROM (
        SELECT
            P.CODPROD,
            P.DESCRICAO,
            F.CODFILIAL,
            P.CODFORNEC,
            FORN.FANTASIA AS NOME_FORNECEDOR,
            FIL.RAZAOSOCIAL AS NOME_FILIAL,
            (NVL(EST.QTESTGER, 0) - NVL(EST.QTRESERV, 0) - NVL(EST.QTBLOQUEADA, 0) - NVL(EST.QTINDENIZ, 0)) AS QT_DISPONIVEL,
            -- 1 linha por produto x filial: prioriza a região de preço da própria
            -- filial; usa a região geral (99) só como fallback.
            ROW_NUMBER() OVER (
                PARTITION BY P.CODPROD, F.CODFILIAL
                ORDER BY CASE WHEN REG.CODFILIAL = F.CODFILIAL THEN 0 ELSE 1 END, REG.NUMREGIAO
            ) AS RN,
            -- Lógica STATUS_INTEGRACAO
            CASE
                WHEN P.REVENDA = 'S'
                AND P.DTEXCLUSAO IS NULL
                AND F.PROIBIDAVENDA = 'N'
                AND F.FORALINHA = 'N'
                AND F.ATIVO = 'S'
                AND F.ENVIARFORCAVENDAS = 'S'
                AND P.IONSYNC = 'Y'
                AND NVL(TAB.PVENDA, 0) > 0
                AND NVL(EST.CUSTOFIN, 0) > 0
                AND NVL(EST.CUSTOREP, 0) > 0
                AND NVL(EST.CUSTOREAL, 0) > 0
                AND TAB.CODST IS NOT NULL
                THEN 'PRODUTO_NA_ION'
                ELSE 'FALTA_REVISAR'
            END AS STATUS_INTEGRACAO,
            -- Diagnóstico Detalhado
            TRIM(
                CASE WHEN P.REVENDA <> 'S' THEN 'Revenda não é "S" | ' ELSE '' END ||
                CASE WHEN F.PROIBIDAVENDA = 'S' THEN 'Venda Proibida na Filial | ' ELSE '' END ||
                CASE WHEN F.FORALINHA = 'S' THEN 'Produto Fora de Linha | ' ELSE '' END ||
                CASE WHEN F.ATIVO = 'N' THEN 'Inativo na Filial | ' ELSE '' END ||
                CASE WHEN P.ENVIARFORCAVENDAS = 'N' THEN 'Não Envia Força Venda | ' ELSE '' END ||
                CASE WHEN TAB.CODST IS NULL THEN 'Sem Tributação na Região (Rot. 271) | ' ELSE '' END ||
                CASE WHEN NVL(TAB.PVENDA, 0) <= 0 THEN 'Sem Preço de Venda | ' ELSE '' END ||
                CASE WHEN NVL(EST.CUSTOFIN, 0) <= 0 THEN 'Sem Custo Fin. | ' ELSE '' END ||
                CASE WHEN NVL(EST.CUSTOREAL, 0) <= 0 THEN 'Sem Custo Real | ' ELSE '' END
            ) AS MOTIVOS_PENDENCIA,
            CASE
                WHEN (NVL(EST.QTESTGER, 0) - NVL(EST.QTRESERV, 0) - NVL(EST.QTBLOQUEADA, 0) - NVL(EST.QTINDENIZ, 0)) > 0
                THEN 'COM_ESTOQUE'
                ELSE 'SEM_ESTOQUE'
            END AS SITUACAO_ESTOQUE,
            TAB.CODST AS COD_TRIB_271,
            TR.MENSAGEM AS MSG_TRIBUTACAO,
            P.NBM AS NCM
        FROM PCPRODUT P
        INNER JOIN PCPRODFILIAL F ON P.CODPROD = F.CODPROD
        INNER JOIN PCREGIAO REG ON (REG.CODFILIAL = F.CODFILIAL OR REG.CODFILIAL = '99')
        LEFT JOIN PCTABPR TAB ON (TAB.CODPROD = F.CODPROD AND TAB.NUMREGIAO = REG.NUMREGIAO)
        LEFT JOIN PCTRIBUT TR ON (TAB.CODST = TR.CODST)
        LEFT JOIN PCEST EST ON (EST.CODPROD = F.CODPROD AND EST.CODFILIAL = F.CODFILIAL)
        LEFT JOIN BRAGO.PCFORNEC FORN ON FORN.CODFORNEC = P.CODFORNEC
        LEFT JOIN PCFILIAL FIL ON FIL.CODIGO = F.CODFILIAL
        WHERE
            P.DTEXCLUSAO IS NULL
            AND P.REVENDA = 'S'
            AND F.PROIBIDAVENDA = 'N'
            AND F.CODFILIAL IN (6, 20, 21, 22, 23)
            AND REG.STATUS NOT IN ('I', 'C')
            AND P.CODEPTO NOT IN (6, 103)
    ) X
    WHERE X.RN = 1
)
WHERE "STATUS_INTEGRACAO" = 'FALTA_REVISAR'
ORDER BY
    CASE WHEN "Situação Estoque" = 'COM ESTOQUE' THEN 0 ELSE 1 END,
    "Fornecedor",
    "Filial",
    "Produto"
