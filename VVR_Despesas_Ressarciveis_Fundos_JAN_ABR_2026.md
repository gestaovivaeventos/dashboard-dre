# Conferência DRE — Despesas Ressarcíveis - Fundos

**Empresa:** Viva Volta Redonda
**Conta DRE:** 5.9 — Despesas Ressarcíveis - Fundos
**Períodos analisados:** Janeiro/2026 e Abril/2026
**Fonte:** `financial_entries` (base do Dashboard) — sincronização Omie em 20/04/2026
**Categorias Omie mapeadas para 5.9 (VVR):** `2.08.94`, `2.08.96`, `2.08.98` (mapeamento via prefixo `__fundos_desp_`)

---

## Resumo

| Período | Qtd. lançamentos | Total Dashboard | Total Omie (informado) | Diferença |
|---|---|---|---|---|
| Janeiro/2026 | 20 | **R$ 21.019,69** | R$ 21.019,69 | **R$ 0,00** ✅ |
| Abril/2026 | 34 | **R$ 4.137,54** | R$ 4.135,54 | **R$ 2,00** ⚠️ |

---

## Causa provável da divergência em Abril/2026

Em 20/04/2026 há **4 tarifas Omie.CASH de R$ 0,50** (cOrigem = `EXTP`) geradas automaticamente, somando exatamente os R$ 2,00 de diferença. Provavelmente esses lançamentos não foram considerados no relatório consultado na Omie, mas estão contabilizados no Dashboard porque caem na categoria `2.08.96`.

| Data | omie_id | Categoria | Valor |
|---|---|---|---|
| 20/04/2026 | mov:0:tar.20260420.114736:EXTP:74 | 2.08.96 | R$ 0,50 |
| 20/04/2026 | mov:0:tar.20260420.114736:EXTP:75 | 2.08.96 | R$ 0,50 |
| 20/04/2026 | mov:0:tar.20260420.114736:EXTP:76 | 2.08.96 | R$ 0,50 |
| 20/04/2026 | mov:0:tar.20260420.114736:EXTP:77 | 2.08.96 | R$ 0,50 |
| | | **Subtotal** | **R$ 2,00** |

Descrição na Omie: *"Gerado automaticamente pelo Omie.CASH. Trata-se da tarifa referente à transferência via PIX..."*

> **Recomendação:** confirmar com o time financeiro se essas 4 tarifas Omie.CASH (categoria 2.08.96) devem ou não compor a linha "Despesas Ressarcíveis - Fundos". Se não devem, a categoria 2.08.96 precisa ser remapeada para outra conta DRE (ex.: tarifas bancárias).

---

## Janeiro/2026 — 20 lançamentos = R$ 21.019,69

| # | Data | omie_id | Cat. | Valor (R$) | Fornecedor | Observação |
|---|---|---|---|---:|---|---|
| 1 | 08/01/2026 | mov:11104868750:001/001:MANP | 2.08.94 | 200,00 | JULIANA LEAL MOYSES - SANTANDER | REEMBOLSO JULIANA - MO / limpeza extra |
| 2 | 14/01/2026 | mov:11104626707:001/001:MANP | 2.08.94 | 337,04 | CAIO CESAR MOREIRA DA SILVA | REEMBOLSO FEINNI - MED ARKAN |
| 3 | 14/01/2026 | mov:11104627748:001/001:MANP | 2.08.94 | 3.182,44 | RTH COMERCIO DE DOCES LTDA | RHT COMERCIO DOCES - MED ARKAN |
| 4 | 15/01/2026 | mov:11104631252:001/001:MANP | 2.08.94 | 323,29 | RESTAURANTE DIVINA MALOCA | ALIMENTAÇÃO EQUIPE - MED ARKAN |
| 5 | 16/01/2026 | mov:11104632896:001/001:MANP | 2.08.94 | 518,98 | RESTAURANTE DIVINA MALOCA | ALIMENTAÇÃO EQUIPE - MED ARKAN |
| 6 | 19/01/2026 | mov:11104656491:001/001:MANP | 2.08.94 | 60,30 | AUTOSNACK JUIZ DE FORA | ALIMENTAÇÃO MED ARKAN |
| 7 | 19/01/2026 | mov:11104656995:001/001:MANP | 2.08.94 | 283,63 | GRAAL COMERCIO | ALIMENTÇÃO MED ARKAN - GRAAL |
| 8 | 19/01/2026 | mov:11104657325:001/001:MANP | 2.08.94 | 53,00 | AUTOSNACK JUIZ DE FORA | ALIMENTAÇÃO MED ARKAN |
| 9 | 19/01/2026 | mov:11104658005:001/001:MANP | 2.08.94 | 90,00 | AUTOSNACK JUIZ DE FORA | ALIMENTAÇÃO MED ARKAN |
| 10 | 19/01/2026 | mov:11104661468:001/001:MANP | 2.08.94 | 212,11 | GRAAL COMERCIO | ALIMENTÇÃO MED ARKAN - GRAAL |
| 11 | 19/01/2026 | mov:11104669015:001/001:MANP | 2.08.94 | 23,70 | GRAAL COMERCIO | ALIMENTÇÃO MED ARKAN - SÃO LUIZ LANCHES |
| 12 | 19/01/2026 | mov:11104657674:001/001:MANP | 2.08.94 | 392,50 | AUTOSNACK JUIZ DE FORA | ALIMENTAÇÃO MED ARKAN |
| 13 | 19/01/2026 | mov:11104634001:001/001:MANP | 2.08.94 | 487,08 | RESTAURANTE DIVINA MALOCA | ALIMENTAÇÃO EQUIPE - MED ARKAN - SAPORE |
| 14 | 19/01/2026 | mov:11104635290:001/001:MANP | 2.08.94 | 276,00 | ACEITE COMERCIO LTDA | ALIMENTAÇÃO EQUIPE - MED ARKAN |
| 15 | 19/01/2026 | mov:11104638820:001/001:MANP | 2.08.94 | 109,80 | ACEITE COMERCIO LTDA | ALIMENTAÇÃO EQUIPE - MED ARKAN |
| 16 | 19/01/2026 | mov:11104654176:001/001:MANP | 2.08.94 | 13.900,00 | MCDONALD'S | MC DONALDS MED ARKAN |
| 17 | 23/01/2026 | mov:11104703244:001/001:MANP | 2.08.94 | 253,50 | IGOR ANTONIO DE CARVALHO | REEMBOLSO - PICOLE MED ARTEMIS |
| 18 | 23/01/2026 | mov:0:pix.20260123.132802:EXTP:9491 | 2.08.96 | 116,47 | CATIUSCIA NUNES DE MEDEIROS | Transferência via PIX (Omie.CASH) |
| 19 | 23/01/2026 | mov:0:tar.20260123.132805:EXTP:9492 | 2.08.96 | 0,50 | — | Tarifa Omie.CASH |
| 20 | 29/01/2026 | mov:11104857947:001/001:MANP | 2.08.94 | 199,35 | RESTAURANTE MIRANTE DA SERRA | ALIMENTAÇÃO EQUIPE VALENÇA - MED AVICENA |
| | | | | **21.019,69** | | |

---

## Abril/2026 — 34 lançamentos = R$ 4.137,54

| # | Data | omie_id | Cat. | Valor (R$) | Fornecedor | Observação |
|---|---|---|---|---:|---|---|
| 1 | 09/04/2026 | mov:11146367557:001/001:MANP | 2.08.98 | 133,52 | ANGELICA DE CARVALHO SILVA | REEMBOLSO PRA UNIDADE DE BONIFI |
| 2 | 09/04/2026 | mov:11146369649:001/001:MANP | 2.08.98 | 400,00 | ANA CAROLINE DE SOUZA E SILVA | REEMBOLSO 3 ATAS DE ADESÃO |
| 3 | 20/04/2026 | mov:0:tar.20260420.114736:EXTP:74 | 2.08.96 | 0,50 | — | ⚠️ Tarifa Omie.CASH |
| 4 | 20/04/2026 | mov:0:tar.20260420.114736:EXTP:75 | 2.08.96 | 0,50 | — | ⚠️ Tarifa Omie.CASH |
| 5 | 20/04/2026 | mov:0:tar.20260420.114736:EXTP:76 | 2.08.96 | 0,50 | — | ⚠️ Tarifa Omie.CASH |
| 6 | 20/04/2026 | mov:0:tar.20260420.114736:EXTP:77 | 2.08.96 | 0,50 | — | ⚠️ Tarifa Omie.CASH |
| 7 | 20/04/2026 | mov:0:pix.20260420.114110:EXTP:83 | 2.08.96 | 557,70 | IGOR ANTONIO DE CARVALHO | PIX Omie.CASH |
| 8 | 20/04/2026 | mov:0:pix.20260420.114125:EXTP:84 | 2.08.96 | 277,97 | IGOR ANTONIO DE CARVALHO | PIX Omie.CASH |
| 9 | 20/04/2026 | mov:0:pix.20260420.114137:EXTP:85 | 2.08.96 | 796,90 | IGOR ANTONIO DE CARVALHO | PIX Omie.CASH |
| 10 | 23/04/2026 | mov:0:RP 842300:EXTP:124 | 2.08.94 | 185,89 | CASABELLA O SHOPPING DO LAR | 17/04 SM PRESENTES BARRA MANSA |
| 11 | 23/04/2026 | mov:0:RP 842297:EXTP:125 | 2.08.94 | 100,00 | POSTO CASTELO DA BOCANHA | 18/04 AUTO POSTO CARAVELAS |
| 12 | 23/04/2026 | mov:0:RP 835846:EXTP:126 | 2.08.94 | 160,00 | CESAR PARK HOTEL | 29/03 CESAR PARK HOTEL JF |
| 13 | 23/04/2026 | mov:11153199191:001/001:MANP | 2.08.94 | 179,40 | DISTRIBUIDORA DE BEBIDAS IMPER | Depósito Ton |
| 14 | 23/04/2026 | mov:0:RP 835855:EXTP:112 | 2.08.94 | 100,00 | AUTO POSTO SATURNO BM LTDA | 29/03 POSTO TOP CENTRO JF |
| 15 | 23/04/2026 | mov:0:RP 842352:EXTP:111 | 2.08.94 | 100,00 | POSTO CASTELO DA BOCANHA | 28/03 AUTO POSTO CARAVELAS |
| 16 | 23/04/2026 | mov:0:RP 840992:EXTP:114 | 2.08.94 | 56,15 | MERCADO PAGO | 08/04 MERCADOLIVRE 4PRODUTOS |
| 17 | 23/04/2026 | mov:0:RP 840991:EXTP:115 | 2.08.94 | 56,15 | MERCADO PAGO | 08/04 MERCADOLIVRE 4PRODUTOS |
| 18 | 23/04/2026 | mov:0:RP 840990:EXTP:116 | 2.08.94 | 56,15 | MERCADO PAGO | 08/04 MERCADOLIVRE 4PRODUTOS |
| 19 | 23/04/2026 | mov:0:RP 840989:EXTP:117 | 2.08.94 | 56,15 | MERCADO PAGO | 08/04 MERCADOLIVRE 4PRODUTOS |
| 20 | 23/04/2026 | mov:0:RP 842349:EXTP:118 | 2.08.94 | 100,00 | SULGAS | 09/04 SULGAS COMERCIO VR |
| 21 | 23/04/2026 | mov:0:RP 835719:EXTP:106 | 2.08.94 | 54,98 | DROGARIA MAZZONI | 21/03 DROGARIA LOPES ARMAÇÃO |
| 22 | 23/04/2026 | mov:0:RP 835719:EXTP:103 | 2.08.94 | 83,70 | DECORAR FESTAS | 21/03 DECORA LOCAÇÃO ARMAÇÃO |
| 23 | 23/04/2026 | mov:0:RP 841350:EXTP:104 | 2.08.94 | 14,95 | MCA VIDAL EMBALAGENS LTDA | 09/04 MCA VIDAL EMBALAGENS BM |
| 24 | 23/04/2026 | mov:0:RP 841352:EXTP:105 | 2.08.94 | 100,00 | POSTO RETORNO | 11/04 POSTO DO RETORNO BM |
| 25 | 23/04/2026 | mov:0:RP 835716:EXTP:107 | 2.08.94 | 100,00 | SHOPPING ALUMIFOGOS | 22/03 SHOPPING VIA LAGOS RIO BONITO |
| 26 | 23/04/2026 | mov:0:RP 835716:EXTP:108 | 2.08.94 | 70,00 | SULGAS | 23/03 SULGAS COMERCIO VR |
| 27 | 23/04/2026 | mov:0:RP 835723:EXTP:109 | 2.08.94 | 24,15 | MARTINS MATERIAIS DE CONSTRUÇÃO | 26/03 R C MARTINS MAT CONS BM |
| 28 | 23/04/2026 | mov:0:RP 835723:EXTP:110 | 2.08.94 | 60,00 | POSTO NOVA VR LIMITADA | 27/03 POSTO NOVA VR VR |
| 29 | 23/04/2026 | mov:0:RP 835855:EXTP:113 | 2.08.94 | 82,80 | POSTO NOVA VR LIMITADA | 29/03 POSTO TOP CENTRO JF |
| 30 | 23/04/2026 | mov:0:RP 841350:EXTP:119 | 2.08.94 | 27,00 | SINGER | 09/04 SINGER BM — TINTA ACRÍLICA |
| 31 | 23/04/2026 | mov:0:RP 841350:EXTP:120 | 2.08.94 | 22,80 | INTERSUL CONSORCIOS LTDA | 11/04 INTERSUL BM — TESOURA E BOL |
| 32 | 23/04/2026 | mov:0:RP 841617:EXTP:121 | 2.08.94 | 147,70 | MERCADO PAGO | 14/04 MERCADOLIVRE 3PRODUTOS |
| 33 | 23/04/2026 | mov:0:RP 842297:EXTP:122 | 2.08.94 | 20,00 | FORMA CATERING | 14/04 CATE PAPELARIA BM |
| 34 | 23/04/2026 | mov:0:RP 842297:EXTP:123 | 2.08.94 | 11,48 | PONTO DOCE BARRA MANSA | 14/04 PONTO DOCE BM |
| | | | | **4.137,54** | | |

---

## Como reproduzir a consulta

```sql
-- DRE 5.9 — Despesas Ressarcíveis - Fundos | VVR
SELECT
  payment_date, omie_id, category_code,
  raw_json->'detalhes'->>'cCodCateg' AS cat_omie_original,
  value, supplier_customer,
  raw_json->'detalhes'->>'observacao' AS obs
FROM public.financial_entries
WHERE company_id = '77001237-d53c-4f1f-b910-25852b53d373'  -- Viva Volta Redonda
  AND category_code IN (
    '__fundos_desp_2.08.94',
    '__fundos_desp_2.08.96',
    '__fundos_desp_2.08.98',
    '2.08.94','2.08.96','2.08.98'
  )
  AND ano_pgto = 2026
  AND mes_pagamento IN (1, 4)
ORDER BY payment_date;
```
