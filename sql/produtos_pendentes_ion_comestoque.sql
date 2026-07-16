SELECT
    "STATUS_INTEGRACAO",
    "CODFORNEC",
    "FORNECEDOR",
    "CODFILIAL",
    "REGIAO",
    "REGIAO_NOME",
    "CODPROD",
    "DESCRICAO",
    "PROBLEMA",
    "NCM",
    "ESTOQUE",
    "COD_TRIB",
    "MSG_TRIB"
FROM (
    SELECT
        X.STATUS_INTEGRACAO                                   AS "STATUS_INTEGRACAO",
        X.CODFORNEC                                           AS "CODFORNEC",
        NVL(X.NOME_FORNECEDOR, 'NÃO IDENTIFICADO')            AS "FORNECEDOR",
        X.CODFILIAL                                           AS "CODFILIAL",
        X.NUMREGIAO                                           AS "REGIAO",
        X.REGIAO_NOME                                         AS "REGIAO_NOME",
        X.CODPROD                                             AS "CODPROD",
        X.DESCRICAO                                           AS "DESCRICAO",
        NVL(NULLIF(RTRIM(X.MOTIVOS_PENDENCIA, ' |'), ''),
            'Revisar cadastro (custo de reposição / flag ION)') AS "PROBLEMA",
        X.NCM                                                 AS "NCM",
        ROUND(X.QT_DISPONIVEL, 2)                             AS "ESTOQUE",
        X.COD_TRIB_271                                        AS "COD_TRIB",
        X.MSG_TRIBUTACAO                                      AS "MSG_TRIB"
    FROM (
        SELECT
            P.CODPROD,
            P.DESCRICAO,
            F.CODFILIAL,
            REG.NUMREGIAO,
            REG.REGIAO AS REGIAO_NOME,
            P.CODFORNEC,
            FORN.FANTASIA AS NOME_FORNECEDOR,
            (NVL(EST.QTESTGER, 0) - NVL(EST.QTRESERV, 0) - NVL(EST.QTBLOQUEADA, 0) - NVL(EST.QTINDENIZ, 0)) AS QT_DISPONIVEL,
            -- 1 linha por produto x filial, priorizando a região onde o produto está
            -- PENDENTE (é a que precisa de correção). Se estiver OK em todas, cai numa OK
            -- e o registro é descartado pelo filtro final.
            ROW_NUMBER() OVER (
                PARTITION BY P.CODPROD, F.CODFILIAL
                ORDER BY
                    CASE WHEN (
                        P.REVENDA = 'S' AND P.DTEXCLUSAO IS NULL AND F.PROIBIDAVENDA = 'N'
                        AND F.FORALINHA = 'N' AND F.ATIVO = 'S' AND F.ENVIARFORCAVENDAS = 'S'
                        AND P.IONSYNC = 'Y' AND NVL(TAB.PVENDA, 0) > 0 AND NVL(EST.CUSTOFIN, 0) > 0
                        AND NVL(EST.CUSTOREP, 0) > 0 AND NVL(EST.CUSTOREAL, 0) > 0 AND TAB.CODST IS NOT NULL
                    ) THEN 1 ELSE 0 END,                                      -- pendente (0) primeiro
                    CASE WHEN REG.CODFILIAL = F.CODFILIAL THEN 0 ELSE 1 END,  -- região da própria filial
                    REG.NUMREGIAO
            ) AS RN,
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
        WHERE
            P.DTEXCLUSAO IS NULL
            AND P.REVENDA = 'S'
            AND F.PROIBIDAVENDA = 'N'
            AND F.CODFILIAL IN (6, 20, 21, 22, 23)
            AND REG.STATUS NOT IN ('I', 'C')
            AND P.CODEPTO NOT IN (6, 103)
            -- Exclui recondicionados (sufixo/token " RC" ou " REC" na descrição)
            AND NOT REGEXP_LIKE(P.DESCRICAO, '(^|[[:space:]])(RC|REC)([[:space:]]|$)', 'i')
    ) X
    WHERE X.RN = 1
      AND X.QT_DISPONIVEL > 0
)
WHERE "STATUS_INTEGRACAO" = 'FALTA_REVISAR'
ORDER BY "FORNECEDOR", "CODPROD", "CODFILIAL"
