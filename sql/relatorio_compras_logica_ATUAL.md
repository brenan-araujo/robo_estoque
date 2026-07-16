# Relatório de Compras — Lógica ATUAL (congelada antes da winsorização)

Documento de referência da **forma atual** de calcular a sugestão de compra, salvo
antes de aplicar a melhoria de winsorização + classificação de demanda.

- Base: **WinThor (Oracle)**, tabela de movimentos `PCMOV`.
- Código: [src/services/purchasingOracleService.js](../src/services/purchasingOracleService.js)
  (consulta + cálculo) e [src/services/purchasingExcelService.js](../src/services/purchasingExcelService.js) (sugestão de qtd).
- Data deste registro: 2026-06-29.

---

## 1. Universo de produtos considerados

Filtros aplicados (produto × filial):
- `PCMOV.CODOPER = 'S'` (vendas), `DTMOV >= SYSDATE - 90` (janela de giro = 90 dias).
- Filiais `6, 20, 21, 22, 23`, com **filial 6 consolidada na 20** (DF tratada como uma só).
- `PCPRODUT.REVENDA = 'S'`, `CODEPTO IN (1,2,3,7)`.
- Exclui fornecedores `3, 4, 14566, 14631, 14574, 14573` (filiais/internos) e `OBS2 = 'FL'`.
- **Mínimo de 5 dias com venda** no período (`DIAS_COM_VENDA >= 5`).

## 2. Venda Diária (peça central)

Média **ponderada por recência** e **líquida de devoluções**:

```
VENDA_DIA = ( 3*S0_30 + 2*S30_60 + 1*S60_90 ) / (2 * janelaGiro)
```
- `Sx_y` = soma de `QT - NVL(QTDEVOL,0)` dos movimentos no terço correspondente da janela
  (terço mais recente pesa 3, do meio 2, mais antigo 1).
- Denominador `2 * janelaGiro` (com janela 90 = 180). Piso em 0.
- **Devoluções descontadas** via `QTDEVOL` no próprio movimento de venda.

> Esta já é a versão melhorada hoje (antes era `SUM(QT)/90`, média simples e bruta).

## 3. Estoque, pedidos e prazo

- **Estoque disponível** (`PCEST`): `QTESTGER - QTRESERV - QTBLOQUEADA`, somando filiais
  20+6 quando a filial mapeada é 20; senão a própria filial.
- **Saldo de pedidos** (`PCITEM`+`PCPEDIDO`): `QTPEDIDA - QTENTREGUE` de pedidos com
  `DTPREVENT >= hoje` e `DTENTRADAESTOQUE IS NULL` (ainda não recebidos).
- **Tempo do fornecedor**: `PCFORNEC.PRAZOENTREGA` (default 7 dias).

## 4. Coberturas e Status

```
Cobertura Física = Estoque Disponível / Venda Diária
Cobertura Total  = (Estoque + Saldo de Pedidos) / Venda Diária
```

| Condição                                             | Status     |
|------------------------------------------------------|------------|
| Cobertura Física  >= Tempo Fornecedor                | SAUDÁVEL   |
| Cobertura Física  <  Tempo e Cobertura Total <  Tempo| CRÍTICO    |
| Cobertura Física  <  Tempo e Cobertura Total >= Tempo| ATENÇÃO    |

(`CALCULO` = margem em dias = cobertura − tempo do fornecedor; negativo = gap.)

## 5. Sugestão de Compra (quantidade)

```
Sugestão = (Venda Diária × Tempo Fornecedor) − (Estoque + Saldo de Pedidos)
```
- Só sugere quando Cobertura Total < Tempo Fornecedor.
- Se estoque físico = 0, arredonda para cima (mínimo 1); senão arredonda normal.

## 6. Curva ABC

Pareto 80/15/5 por filial, baseado no **faturamento líquido** (`(QT-QTDEVOL)*PUNIT`)
acumulado decrescente: A até 80%, B até 95%, C o restante.

---

## 7. Limitação conhecida (motivo da próxima melhoria)

O modelo assume **demanda contínua**. Para itens **esporádicos / de cliente único /
com pico de venda concentrado num só dia**, a média diária superestima a demanda e a
sugestão fica inflada (ex.: produto 18604 FIBRA LIMP, filial 21 — um pedidão de ~1.250
un de um único cliente vira "30/dia" e sugere comprar 407).

Melhoria planejada (ver planilha de nova lógica): **winsorização** do dia de pico +
**classificação de perfil de demanda** (CONTÍNUO / IRREGULAR / SOB DEMANDA), tirando os
itens sob demanda da sugestão automática e mandando-os para revisão manual.
