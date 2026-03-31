# Sync Incremental com Marca d'Agua

**Data:** 2026-03-31
**Status:** Aprovado
**Escopo:** Refatorar o sync de dados Omie para usar marca d'agua (watermark) incremental, com botao manual de full sync por empresa.

---

## Contexto

O sync atual busca TODOS os movimentos do ano inteiro para todas as empresas, toda vez que roda. Com ~22 empresas e volumes de 20 a 200 movimentos/mes, isso e desnecessariamente pesado. Movimentos antigos raramente sao alterados (apenas estornos excepcionais).

### Problema

- Full refresh diario e lento e consome muitas chamadas de API Omie
- Volume cresce linearmente com numero de empresas e historico
- Rate limit da Omie (350ms entre chamadas) amplifica o problema

---

## Decisoes de Design

### Dois modos de sync

| Modo | Trigger | dateFrom | dateTo | Deleta obsoletos? |
|------|---------|----------|--------|-------------------|
| **Incremental** | Cron diario (6h UTC) | `last_full_sync_at - 3 dias` | hoje | Nao |
| **Full** | Botao manual (por empresa) | `hoje - 24 meses` | hoje | Sim |
| **Primeira vez** | Automatico (NULL watermark) | `01-01-2022` | hoje | Sim |

### Por que -3 dias de margem no incremental?

Estornos raros podem retroagir alguns dias. 3 dias e conservador sem puxar dados demais.

### Por que 24 meses no full manual?

Janela suficiente para historico operacional. A primeira vez puxa desde 2022 para ter o historico completo.

### Por que nao deletar no incremental?

Dados antigos raramente mudam. Deletar sem ter buscado o periodo completo seria perigoso — poderia remover dados validos que simplesmente nao estavam no range incremental.

---

## Modelo de Dados

### Nova coluna em `companies`

```sql
ALTER TABLE companies
ADD COLUMN last_full_sync_at timestamptz;
```

- `NULL` = empresa nunca fez full sync (primeira vez pendente)
- Atualizada apenas ao final de um full sync bem-sucedido

### Nova coluna em `sync_log`

```sql
ALTER TABLE sync_log
ADD COLUMN sync_type text NOT NULL DEFAULT 'full'
CHECK (sync_type IN ('incremental', 'full'));
```

---

## Logica de Sync

### Incremental (cron diario)

```
Para cada empresa:
  1. Ler last_full_sync_at
  2. Se NULL → executar Full (primeira vez, desde 01-01-2022)
  3. Se existe:
     a. dateFrom = last_full_sync_at - 3 dias
     b. dateTo = hoje
     c. Buscar movimentos da Omie nesse range
     d. Upsert por (company_id, omie_id)
     e. NAO deletar nada
     f. Registrar sync_log com sync_type = 'incremental'
```

### Full (botao manual, por empresa — tambem usado na primeira vez)

```
1. Calcular dateFrom:
   - Se last_full_sync_at IS NULL (primeira vez) → 01-01-2022
   - Senao → hoje - 24 meses
2. dateTo = hoje
3. Buscar TODOS movimentos da Omie nesse range
4. Upsert por (company_id, omie_id)
5. SOMENTE se (4) deu certo:
   → Deletar entries no banco que NAO vieram da Omie
6. SOMENTE se (5) deu certo:
   → Atualizar last_full_sync_at = agora
7. Registrar sync_log com sync_type = 'full'
```

### Ordem de operacoes no full (seguranca)

```
Buscar da Omie → Upsert → Deletar obsoletos → Atualizar watermark
```

Se falhar em qualquer passo, os passos seguintes NAO executam. Pior cenario: dados duplicados temporariamente, nunca perde dado.

---

## API

### Endpoint existente (sem mudanca de contrato)

```
POST /api/sync/[companyId]
```

Continua funcionando, agora roda incremental por padrao.

### Novo endpoint

```
POST /api/sync/[companyId]/full
```

- Autorizacao: `admin` ou `gestor_hero`
- Corpo: vazio
- Resposta: `{ ok: boolean, records_imported: number, records_deleted: number }`
- Roda full sync (24 meses ou desde 2022 se primeira vez)

### Cron (mudanca interna apenas)

```
GET /api/cron/sync-all
```

- Configuracao no vercel.json NAO muda (`0 6 * * *`)
- Internamente agora roda incrementais (ou full para empresas novas)

---

## UI

### Pagina de Conexoes (`/conexoes`)

Na listagem de empresas, cada empresa ganha um botao **"Sincronizar Tudo"** separado do sync normal.

**Comportamento:**

1. Clique abre confirmacao:
   - Se `last_full_sync_at` IS NULL: "Primeira sincronizacao — sera buscado historico desde 2022. Isso pode levar varios minutos."
   - Senao: "Isso vai buscar 24 meses de historico. Pode levar alguns minutos."
2. Botao fica em estado de loading durante a execucao
3. Ao final, mostra toast com resultado:
   - Sucesso: "X registros importados, Y obsoletos removidos"
   - Erro: mensagem de erro com opcao de tentar novamente

### Indicador visual de status

Exibir ao lado de cada empresa:
- `last_full_sync_at` formatado (ex: "Ultima sync completa: 28/03/2026")
- Se NULL: badge "Pendente" indicando que a primeira sync completa ainda nao foi feita

---

## Tratamento de Erros

### Incremental (cron)

- Comportamento atual mantido: se uma empresa falha, continua com as outras
- Email de falha via Resend (ja existe)
- Email de categorias nao mapeadas (ja existe)

### Full (manual)

- Se falhar no meio, `last_full_sync_at` NAO e atualizado
- Cleanup so roda apos upsert ter sucesso
- UI mostra mensagem de erro com opcao de tentar novamente

---

## Migracao

### Empresas existentes

Ao aplicar a migration, `last_full_sync_at` sera NULL para todas as empresas. Isso significa que no proximo cron, cada empresa fara um full sync automatico (desde 2022) antes de passar para incrementais. Esse e o comportamento desejado — garante que a marca d'agua seja inicializada corretamente.

### Alternativa: setar watermark para empresas que ja sincronizaram

Se quiser evitar o full sync inicial para empresas que ja tem dados, a migration pode setar `last_full_sync_at = NOW()` para empresas que ja possuem entries no banco.

---

## Estimativa de Impacto

### Antes (full refresh diario)

- 22 empresas x ~12 meses x ~100 mov/mes media = ~26.400 movimentos buscados por dia
- A 350ms entre chamadas: varios minutos de execucao

### Depois (incremental diario)

- 22 empresas x ~1 mes (30 dias + 3 margem) x ~100 mov/mes = ~2.200 movimentos
- Reducao de ~90% no volume de chamadas diarias

### Full manual (eventual)

- 1 empresa x 24 meses x ~100 mov/mes = ~2.400 movimentos
- Executado sob demanda, sem impacto no cron

---

## Arquivos Afetados

1. **Nova migration SQL** — adicionar `last_full_sync_at` em `companies` e `sync_type` em `sync_log`
2. **`src/lib/omie/sync.ts`** — refatorar `syncEntries` para aceitar modo (incremental/full), calcular ranges dinamicamente
3. **`src/app/api/sync/[companyId]/full/route.ts`** — novo endpoint para full sync manual
4. **`src/app/api/cron/sync-all/route.ts`** — adaptar para rodar incrementais
5. **`src/app/(app)/conexoes/page.tsx`** — botao "Sincronizar Tudo" e indicador de status
6. **`src/lib/supabase/types.ts`** — regenerar tipos apos migration
