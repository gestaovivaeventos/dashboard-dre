<!-- GUIA DE IMPLEMENTAÇÃO E TESTE - DRE EM REGIME DE CAIXA -->

# Guia de Implementação - Correção de Movimentações DRE

## 🎯 Visão Geral

Foi implementada uma **camada de processamento financeiro intermediária** que garante que todas as 11 regras de negócio sejam aplicadas corretamente aos lançamentos da Omie antes que entrem na DRE.

### Arquivos Principais

| Arquivo | Propósito |
|---------|-----------|
| `src/lib/omie/financial-processor.ts` | **Núcleo**: Processa movimentações com as 11 regras |
| `src/lib/omie/sync.ts` | Orquestra sincronização, agora usa o processor |
| `supabase/migrations/20260325120000_*.sql` | Adiciona campos de auditoria ao BD |
| `supabase/migrations/20260325130000_*.sql` | Funções SQL para agregação e auditoria |

---

## 📋 As 11 Regras Implementadas

### 1. **Fonte de Dados**
- API ListarMovimentos da Omie
- Filtro por dDtPagamento (regime caixa)

### 2. **Regra do Período**
- Derivação: `ano_pgto` e `mes_pagamento` de `dDtPagamento`
- Salvos em `financial_entries` para rastreabilidade

### 3. **Verificador de Rateio**
```
cCodCateg1 vazio  → sem rateio (0 categorias)
cCodCateg2 vazio  → 1 categoria rateada
cCodCateg3 vazio  → 2 categorias rateadas
cCodCateg4 vazio  → 3 categorias rateadas
cCodCateg5 vazio  → 4 categorias rateadas
Todas preenchidas → 5 categorias rateadas
```

### 4. **Corretor de Duplicidade**
- **Com rateio**: `corretor=0`, usa `nDistrValor1..5`
- **Sem rateio (CONTA_CORRENTE_PAG/REC)**: `corretor=1`, usa `nValPago`
- **Sem rateio (outros)**: `corretor=1`, usa `nValLiquido`

### 5. **Verificador BAXP**
- Exclui lançamentos com `cOrigem` = BAXP ou BAXR

### 6. **Consolidação de Dados**
- Agrupa por período (ano_pgto/mes_pagamento) e categoria
- Respeita de/para Omie → DRE

### 7. **Rateio**
- Quebra em até 5 parcelas
- Cada parcela com sua categoria e valor específico

### 8. **De/Para**
- Mapeamento Omie category_code → DRE dre_account_id

### 9. **Filtro de Período**
- Aplica todas as regras ANTES da consolidação

### 10. **O que foi Feito**
- ✅ Análise completa da lógica
- ✅ Identificação de problemas
- ✅ Camada intermediária auditável
- ✅ Código claro e bem documentado
- ✅ Fácil de testar

### 11. **Importância**
- ✅ Sem simplificações
- ✅ Base Omie tratada antes de consolidar
- ✅ Foco em fazer a DRE bater

---

## 🚀 Como Usar

### 1. Executar Migrações

```bash
# Via CLI
supabase db push

# Ou manualmente no SQL Editor do Supabase:
# 1. Execute: 20260325120000_add_financial_entries_audit_fields.sql
# 2. Execute: 20260325130000_update_dre_aggregation_functions.sql
```

### 2. Sincronizar Dados

```typescript
// Via API ou admin UI
POST /api/sync/[companyId]
```

### 3. Validar no Banco de Dados

```sql
-- Ver todas as entradas com metadados
SELECT 
  omie_id,
  payment_date,
  ano_pgto,
  mes_pagamento,
  category_code,
  value,
  processing_metadata->>'verificador_rateio' as rateio,
  processing_metadata->>'corretor_duplicidade' as corretor,
  processing_metadata->>'source_field_value' as valor_usado
FROM public.financial_entries
WHERE company_id = 'YOUR_COMPANY_UUID'
ORDER BY payment_date DESC
LIMIT 50;
```

---

## 🔍 Funções de Auditoria SQL

### Debug: Ver Todas as Entradas Processadas

```sql
SELECT * FROM debug_financial_entries_detailed(
  ARRAY['company_uuid']::uuid[],
  '2026-01-01'::date,
  '2026-12-31'::date,
  100  -- limit
);
```

**Retorna**: omie_id, categoria, valor, metadata completa, e campos de auditoria

### Auditoria: Verificar Rateios

```sql
SELECT * FROM audit_rateio_entries(
  ARRAY['company_uuid']::uuid[],
  '2026-01-01'::date,
  '2026-12-31'::date
);
```

**Retorna**: Base omie_id, omie_id rateado, e metadados do rateio

### Contar Rateios vs. Sem Rateio

```sql
SELECT 
  COUNT(*) FILTER (WHERE processing_metadata->>'corretor_duplicidade' = '0') as com_rateio,
  COUNT(*) FILTER (WHERE processing_metadata->>'corretor_duplicidade' = '1') as sem_rateio,
  COUNT(*) as total
FROM public.financial_entries
WHERE company_id = 'your_company_uuid';
```

---

## 📊 Exemplo: Lançamento com Rateio

### Entrada Omie Original:
```json
{
  "nCodTitulo": "12345",
  "dDtPagamento": "2026-03-25",
  "cGrupo": "OUTRO",
  "nValPago": 1000,
  "nValLiquido": 1000,
  "cCodCateg1": "101",
  "nDistrValor1": 600,
  "cCodCateg2": "102",
  "nDistrValor2": 400,
  "cCodCateg3": null
}
```

### Processamento:
1. **Verificador BAXP**: ✅ cOrigem não é BAXP/BAXR
2. **Período**: ano_pgto=2026, mes_pagamento=3
3. **Verificador Rateio**: Encontra 2 categorias → verificador_rateio=2
4. **Corretor Duplicidade**: Com rateio → corretor=0
5. **Rateio**: Quebra em 2 entradas

### Entradas Salvas em `financial_entries`:

```json
[
  {
    "omie_id": "mov:12345:::r1",
    "category_code": "101",
    "value": 600,
    "ano_pgto": 2026,
    "mes_pagamento": 3,
    "payment_date": "2026-03-25",
    "processing_metadata": {
      "verificador_rateio": 2,
      "corretor_duplicidade": 0,
      "source_field_value": "nValPago"
    }
  },
  {
    "omie_id": "mov:12345:::r2",
    "category_code": "102",
    "value": 400,
    "ano_pgto": 2026,
    "mes_pagamento": 3,
    "payment_date": "2026-03-25",
    "processing_metadata": {
      "verificador_rateio": 2,
      "corretor_duplicidade": 0,
      "source_field_value": "nValPago"
    }
  }
]
```

### Agregação da DRE:
Via `category_mapping`:
- 101 → DRE Account "Despesa A" = 600
- 102 → DRE Account "Despesa B" = 400
- **Total lançamento**: 1000 ✅ (não duplicado)

---

## ✅ Checklist de Validação

### Antes da Integração

- [ ] Migrações SQL executadas com sucesso
- [ ] Tabela `financial_entries` tem campos: `ano_pgto`, `mes_pagamento`, `processing_metadata`
- [ ] Índices criados para performance
- [ ] Funções SQL criadas: `debug_financial_entries_detailed()`, `audit_rateio_entries()`

### Após Sincronização

- [ ] Lançamentos em `financial_entries` têm `ano_pgto` e `mes_pagamento` preenchidos
- [ ] `processing_metadata` contém verificador_rateio e corretor_duplicidade
- [ ] Nenhum lançamento com cOrigem=BAXP/BAXR foi importado
- [ ] Rateios estão quebrando corretamente (verificar com `audit_rateio_entries()`)
- [ ] Soma de valor dos rateios = valor original do lançamento

### Comparação de Dados

- [ ] DRE mensal antes e depois das mudanças
- [ ] Verificar se totais batem ou estão mais precisos
- [ ] Testar filtros por período: mensal, trimestral, semestral
- [ ] Validar com dados reais da empresa

---

## 🐛 Problemas Comuns

### Problema: "Valores não batem"
**Causas possíveis:**
1. Lançamentos BAXP/BAXR ainda na base (verifique cOrigem)
2. Rateio não foi quebrado corretamente (verifique verificador_rateio)
3. Campo de valor errado utilizado (verifique source_field_value)

**Solução:**
```sql
-- Verificar se há BAXP que entrou
SELECT COUNT(*) FROM financial_entries WHERE raw_json->>'cOrigem' IN ('BAXP', 'BAXR');

-- Verificar rateios
SELECT * FROM audit_rateio_entries(...);

-- Validar metadados
SELECT raw_json, processing_metadata FROM financial_entries LIMIT 1;
```

### Problema: "Campos de período NULL"
**Causa:** Migrações não foram executadas

**Solução:**
```bash
supabase db push
```

### Problema: "Valores duplicados na DRE"
**Causa:** Provável que corretor_duplicidade=1 quando deveria ser 0 (rateio não detectado)

**Solução:**
```sql
-- Verificar movimentos com corretor=1 e verificador_rateio>0 (suspeito)
SELECT omie_id, processing_metadata->'verificador_rateio', 
       processing_metadata->'corretor_duplicidade'
FROM financial_entries
WHERE (processing_metadata->>'verificador_rateio')::int > 0
  AND (processing_metadata->>'corretor_duplicidade')::int = 1;
```

---

## 📚 Referência de Tipos

### ProcessedFinancialEntry (saída do processor)

```typescript
{
  omie_id: string;                    // Identificador único
  company_id: string;                 // UUID da empresa
  type: "receita" | "despesa";        // Tipo
  description: string;                // Descrição
  value: number;                      // Valor final (rateado ou único)
  payment_date: string;               // ISO date: 2026-03-25
  ano_pgto: number;                   // Ano: 2026
  mes_pagamento: number;              // Mês: 1-12
  category_code: string | null;       // Código categoria Omie
  supplier_customer: string | null;   // Terceiro
  document_number: string | null;     // Documento
  raw_json: Record;                   // JSON original da Omie
  processing_metadata: {
    regra_baxp_aplicada: boolean;
    regra_periodo_aplicada: boolean;
    verificador_rateio: 0-5;          // Quantas categorias
    corretor_duplicidade: 0 | 1;      // 0=rateio, 1=valor único
    source_field_value?: string;      // "nValPago" | "nValLiquido"
  };
}
```

---

## 🔗 Links de Referência

- Lógica Principal: [financial-processor.ts](../../src/lib/omie/financial-processor.ts)
- Orquestração: [sync.ts](../../src/lib/omie/sync.ts)
- Funções SQL: [20260325130000_update_dre_aggregation_functions.sql](../../supabase/migrations/20260325130000_update_dre_aggregation_functions.sql)
- Campos DB: [20260325120000_add_financial_entries_audit_fields.sql](../../supabase/migrations/20260325120000_add_financial_entries_audit_fields.sql)

---

## 💡 Próximas Evoluções

1. **Auditoria de Inconsistências**: Alertas quando categoria está preenchida mas valor não
2. **Histórico de Mudanças**: Rastrear quando regras foram aplicadas
3. **Dashboard de Qualidade**: Métricas de rateios, BAXP descartados, etc.
4. **Parametrização**: Período de sincronização conforme demanda
5. **APIs de Teste**: Endpoints para validar processamento passo a passo

