# Contexto — Relatório de Pedidos de Venda com coluna de Nota Fiscal

Queries:
- [pedidos_notas_fiscais.sql](pedidos_notas_fiscais.sql) — principal. Marca
  `CANC`/`DEVOL` na coluna "Nota Fiscal" e traz a coluna "NF Devolução".
- [pedidos_notas_validas.sql](pedidos_notas_validas.sql) — variante que
  **remove** as linhas canceladas e devolvidas (só notas válidas). Mesma lógica
  de detecção, aplicada no `WHERE` em vez de no `CASE`. Validado: principal − CANC
  − DEVOL = válidas (ex.: 5.345 − 34 − 128 = 5.183), sem duplicação.

Base: **WinThor (Oracle)** — tabela principal `PCPEDC`.
Data desta documentação: 2026-06-24.

---

## 1. Objetivo

Partindo de uma query existente que lista o **cabeçalho dos pedidos de venda**
(`PCPEDC`) com cliente, endereço de entrega, plano de pagamento, prazos,
observações e carregamento, o pedido foi **adicionar uma coluna de Nota Fiscal**
com regras específicas de exibição.

## 2. Regra final da coluna "Nota Fiscal"

| Situação                                          | Exibe        |
|---------------------------------------------------|--------------|
| Pedido cancelado (`P.DTCANCEL` preenchida)        | `CANC`       |
| Nota cancelada (`NF.DTCANCEL` preenchida)         | `CANC`       |
| Não faturado (`NVL(P.NUMNOTA,0) = 0`)             | *(em branco)*|
| Devolução TOTAL (valor devolvido >= valor da NF)  | `DEVOL`      |
| Faturado normal (inclui devolução parcial)        | número da NF |

Precedência (ordem do `CASE`): CANC > branco > DEVOL > número.

Implementação:

```sql
CASE
    WHEN P.DTCANCEL IS NOT NULL OR NF.DTCANCEL IS NOT NULL THEN 'CANC'
    WHEN NVL(P.NUMNOTA, 0) = 0                              THEN NULL
    WHEN NVL(DEV.VL_DEVOL, 0) > 0
     AND DEV.VL_DEVOL >= NVL(NF.VLTOTAL, P.VLTOTAL) * 0.999 THEN 'DEVOL'
    ELSE TO_CHAR(P.NUMNOTA)
END AS "Nota Fiscal"
```

- O `TO_CHAR(P.NUMNOTA)` é necessário porque o `CASE` mistura texto (`'CANC'`)
  com número; sem isso o Oracle gera erro de tipo inconsistente.
- **Importante:** o pedido **sempre aparece** no resultado (não há filtro de
  cancelamento no `WHERE`). Toda a lógica de cancelado/branco/devolução está na coluna.

## 3. Como a NF é obtida

Número da NF: `PCPEDC.NUMNOTA` (preenchido no faturamento).

Cancelamento da NF: via `JOIN` em `PCNFSAID` por **`NUMTRANSVENDA`**:

```sql
LEFT JOIN PCNFSAID NF ON NF.NUMTRANSVENDA = P.NUMTRANSVENDA
```

`LEFT JOIN` para que pedidos ainda não faturados continuem aparecendo.

### 3.1. Devolução — DUAS fontes disjuntas

⚠️ Esta base registra devolução de **duas formas diferentes e sem sobreposição**
(ver 4.5). Para não perder casos, a query checa **ambas**, sempre por
`NUMTRANSVENDA` (ambas as colunas são indexadas como coluna líder, então
subquery correlacionada usa índice — eficiente):

**Fonte 1 — NF de entrada de devolução (`PCNFENT`), por valor:**
```sql
WHEN NVL(NF.VLTOTAL, P.VLTOTAL) > 0
 AND (SELECT NVL(SUM(NE.VLTOTAL), 0)
        FROM PCNFENT NE
       WHERE NE.NUMTRANSVENDAORIG = P.NUMTRANSVENDA
         AND NE.DTCANCEL IS NULL) >= NVL(NF.VLTOTAL, P.VLTOTAL) * 0.999
    THEN 'DEVOL'
```
- "Total" = valor devolvido `>=` valor da NF de saída (`NF.VLTOTAL`), tolerância
  0,1%. Critério é o valor **faturado** (`NF.VLTOTAL`), não o `VLTOTAL` do
  pedido (o pedido pode ter valor maior que o efetivamente faturado).

**Fonte 2 — `PCMOV.QTDEVOL` nos movimentos de venda (`CODOPER='S'`), por quantidade:**
```sql
WHEN EXISTS (
        SELECT 1 FROM PCMOV M
         WHERE M.NUMTRANSVENDA = P.NUMTRANSVENDA AND M.CODOPER = 'S'
         GROUP BY M.NUMTRANSVENDA
        HAVING SUM(NVL(M.QTDEVOL, 0)) > 0
           AND SUM(NVL(M.QTDEVOL, 0)) >= SUM(M.QT))
    THEN 'DEVOL'
```
- "Total" = quantidade devolvida `>=` quantidade vendida.

> Histórico: a 1ª versão só usava a Fonte 1 e **perdia** as devoluções da
> Fonte 2 (ex.: pedido 111300221 / NF 30201 / cliente 55466, que não aparecia
> como DEVOL). Caso reportado pelo usuário e corrigido.

### 3.2. Número da NF de devolução — coluna "NF Devolução" (INCLUÍDA na query)

⚠️ NÃO usar `PCMOV.NUMNOTADEV` da venda — é **lixo/legado** (no caso 111300221
trazia `1672`, sendo que a devolução real é a NF **30494**, provada por
casamento item a item: mesmos 16 produtos, qtd 449, R$ 4.898,30).

O vínculo correto e indexado é **`PCMOV.NUMTRANSDEV`** no movimento de devolução
(`CODOPER='ED'`), que aponta para a `NUMTRANSVENDA` da venda. Índice:
`PCMOV_IDX38`. Combinado com `PCNFENT.NUMTRANSVENDAORIG` (Fonte 1), cobre as duas
fontes:

```sql
(SELECT LISTAGG(NUM, ',') WITHIN GROUP (ORDER BY NUM) FROM (
    SELECT DISTINCT M.NUMNOTA NUM FROM PCMOV M
     WHERE M.NUMTRANSDEV = P.NUMTRANSVENDA AND M.CODOPER = 'ED'
    UNION
    SELECT DISTINCT NE.NUMNOTA NUM FROM PCNFENT NE
     WHERE NE.NUMTRANSVENDAORIG = P.NUMTRANSVENDA AND NE.DTCANCEL IS NULL
)) AS "NF Devolução"
```

- Cobertura validada: **522 de 522** linhas marcadas `DEVOL` recebem número
  (100%), incluindo o pedido 111300221 → `30494`.
- A NF de devolução também registra o cliente como `CODFORNEC` e tem
  `FINALIDADENFE='D'` / `NATOPERNFE='DEVOLUCAO DE VENDA...'`, mas o elo usável é
  o `NUMTRANSDEV` (os campos `NUMNOTAVENDA`/`NUMTRANSVENDAORIG` ficam nulos na
  Fonte 2).

## 4. Validações executadas contra o banco real

Período de teste: **01/05/2026 a 24/06/2026**.

### 4.1. Mais de uma NF por pedido?
- Sim, existe, mas é **raríssimo**: em 6 meses, **3 pedidos reais** com 2 NFs
  válidas, de um total de **35.173** pedidos faturados (≈ 0,009%).
- Exemplos: pedidos `10040109`, `10040466`, `10041308` (cada um com 2 NFs).
- Há também um balaio `NUMPED = 0` com 118 NFs avulsas — **não são pedidos**
  reais e não entram quando se filtra por `PCPEDC.DATA`.

### 4.2. O JOIN por NUMTRANSVENDA duplica linhas?
- **Não.** `NUMTRANSVENDA` é **1:1** com `PCNFSAID`
  (MAX de NF por NUMTRANSVENDA = 1, em 36.954 transvendas).
- Confirmado na execução final: `LINHAS = PEDIDOS_DISTINTOS = 11.420`.
- Nos 3 pedidos raros com 2 NFs, `PCPEDC` aponta para a NF **principal/original**;
  a 2ª NF (complemento/refaturamento) não aparece — comportamento desejado
  (1 linha por pedido).

### 4.3. CASE retornando corretamente (período de teste)
| Categoria        | Qtd    | Exemplo                                            |
|------------------|--------|----------------------------------------------------|
| `CANC`           | 79     | pedido 990000739 (tinha NUMNOTA 49722) → `CANC`    |
| *(branco)*       | 533    | pedido 12043646, POSICAO `P`, NUMNOTA null → null  |
| número da NF     | 10.808 | pedido 10041256 → `47892`                          |

### 4.4. Caso "NF cancelada com pedido NÃO cancelado"
- **0 casos** no período. No WinThor desta base, cancelar a NF também marca o
  pedido (`DTCANCEL` / `POSICAO='C'`). Logo a condição `NF.DTCANCEL` é, na
  prática, redundante com `P.DTCANCEL`, mas foi mantida como rede de segurança.

### 4.5. Devolução (DEVOL) — duas fontes disjuntas
Comparação das duas fontes nos pedidos faturados dos últimos 3 meses:

| Fonte                              | Pedidos |
|------------------------------------|---------|
| `PCNFENT.NUMTRANSVENDAORIG`        | 124     |
| `PCMOV.QTDEVOL` (CODOPER='S')      | 602     |
| **Sobreposição entre as duas**     | **0**   |

- São **disjuntas**: nenhum pedido aparece nas duas fontes ao mesmo tempo.
  Por isso é obrigatório checar as duas.
- Com as duas fontes combinadas: **522** pedidos `DEVOL` no período
  01/04–24/06/2026, sem duplicação (`LINHAS = PEDIDOS_DISTINTOS = 17.720`).
- Caso que motivou a correção: pedido **111300221** (NF 30201, cliente 55466,
  transvenda 1450805). `PCMOV`: QT=449, QTDEVOL=449 → devolução total. Não tinha
  registro em `PCNFENT`, por isso a 1ª versão não marcava DEVOL. Agora marca.
- Decisão do usuário: marcar apenas `DEVOL` na coluna NF (sem coluna de valor
  nem distinção parcial/total explícita). Devolução parcial mantém o número.

## 5. Correções e pontos de atenção da query original

### 5.1. Correções JÁ APLICADAS (a query original não rodava / vinha errada)
1. **`CODCLIPRINC` não existe na `PCPEDC`** → a query original dava
   `ORA-00904: "P"."CODCLIPRINC"`. A coluna está na **`PCCLIENT`**. Corrigido o
   filtro para `C.CODCLIPRINC`.
2. **Filtro `NUMPEDCLI` escondia 99% dos pedidos:** com `:NUMPEDCLI` NULL, o
   `LIKE '%'||NVL(:NUMPEDCLI, P.NUMPEDCLI)||'%'` eliminava pedidos com
   `NUMPEDCLI` nulo (no teste: **5.329 → 61** linhas). Corrigido para o padrão
   dos demais filtros: `(:NUMPEDCLI IS NULL OR UPPER(P.NUMPEDCLI) LIKE
   '%'||UPPER(:NUMPEDCLI)||'%')`. Pós-correção: 5.329 linhas, e o filtro ainda
   funciona quando preenchido.

### 5.2. Pontos NÃO aplicados (aguardando decisão)
1. **Filtro de data ignora hora:** `P.DATA BETWEEN TO_DATE(:DT_INICIO) AND
   TO_DATE(:DT_FIM)` pode perder pedidos do dia `DT_FIM` com hora > 00:00.
   Alternativa: `>= DT_INICIO AND < DT_FIM + 1`.
2. **`PCCLIENTENDENT`:** confirmar se a PK é exatamente `(CODCLI, CODENDENTCLI)`
   para evitar duplicação (não causou problema nos testes).
3. **`VLTOTAL` vs `VLATEND`:** "Valor Pedido" é a intenção; venda realizada é
   `VLATEND`.

## 6. Binds da query
`:DT_INICIO`, `:DT_FIM` (formato `DD/MM/YYYY`), `:NUMPED`, `:CODCLI`,
`:CODCLIPRINC`, `:NUMPEDCLI`.
