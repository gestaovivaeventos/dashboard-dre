# Cobertura de férias — Régis → Vitor (Compras / Aprovações)

- **Criado em:** 21/09/2026
- **Motivo:** Régis Adriano Da Costa (perfil *gerente*) está de férias; Vitor de Oliveira Pedrosa (perfil *diretor*) assume as aprovações no período.
- **Retorno do Régis:** _a definir_ → **ao voltar, executar o "Rollback" abaixo.**

## Pessoas

| Papel | Nome | E-mail | ID |
|---|---|---|---|
| Ausente (coberto) | Régis Adriano Da Costa | regis@vivaeventos.com.br | `bcacac55-230e-447c-bb7c-c0ff63ce18ee` |
| Cobrindo | Vitor de Oliveira Pedrosa | vitor@vivaeventos.com.br | `f159c959-55c2-4cc9-a1e4-acc4b2ab69c3` |

## Estado ORIGINAL (o "ponto de retorno" — como era antes de 21/09/2026)

Tudo em código, **nada no banco**:

1. `src/lib/ctrl/routing.ts` → `APPROVAL_ROUTING.expenseTypeManager.managerId`
   - **Original:** `"bcacac55-230e-447c-bb7c-c0ff63ce18ee"` (Régis)
   - **Atual (férias):** `"f159c959-55c2-4cc9-a1e4-acc4b2ab69c3"` (Vitor)
2. `src/lib/ctrl/routing.ts` → `APPROVAL_COVERAGE`
   - **Original:** não existia / array vazio `[]`
   - **Atual (férias):** 1 entrada — Vitor cobre Régis nos setores **Gestão de Pessoas, Bem Laranja, Eventos Oficiais, Despesas Gerais**.

Snapshot de referência do banco (NÃO alterado por esta mudança):
- Régis (`bcacac55…`): `profile=gerente`, `can_compras=true`, 15 vínculos em `user_sectors`.
- Vitor (`f159c959…`): `profile=diretor`, `can_compras=true`, 6 vínculos em `user_sectors`.

## O que muda enquanto vigente

1. **Capacitações e Treinamentos** → a etapa de gerente passa a rotear/notificar o **Vitor** (antes: Régis). Vale em criação, notificação e lembrete.
2. **Vitor recebe o lembrete diário** (etapa de gerente) dos setores **Gestão de Pessoas, Bem Laranja, Eventos Oficiais, Despesas Gerais**.
   - Obs.: como **diretor**, o Vitor **já podia aprovar** qualquer setor e **já via** tudo na tela de Aprovações — a cobertura só garante que ele seja **notificado** por e-mail (e o widget "Aprovações pendentes" da home passa a listar esses itens para ele).
3. A cobertura aparece no catálogo **"Regras especiais"** (tela de Usuários), na linha do Vitor.
4. **Nada muda para o Régis** (perfil, setores e alçada intactos) — ele volta como estava.

> Efeito só após **deploy**: o lembrete diário roda no código publicado (cron). O roteamento de Capacitações também é do código deployado.

## Rollback (quando o Régis voltar) — reverte 100% em código

1. Em `src/lib/ctrl/routing.ts`:
   - Restaure `APPROVAL_ROUTING.expenseTypeManager.managerId` para **`"bcacac55-230e-447c-bb7c-c0ff63ce18ee"`** (Régis).
   - Esvazie `APPROVAL_COVERAGE` para `[]` (remova a entrada Vitor → Régis).
2. Faça o **deploy**.
3. Pronto — volta exatamente como era. **Nada a desfazer no banco.**
