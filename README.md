# Hero DRE Dashboard

Aplicacao Next.js 14 (App Router) com Supabase (Auth + Postgres), shadcn/ui e integracao Omie para DRE gerencial, KPIs, sincronizacao financeira e administracao de usuarios.

## 1. Setup local.

### 1.1 Requisitos

- Node.js 18+
- npm 9+
- Projeto Supabase criado

### 1.2 Clonar e instalar

```bash
git clone <URL_DO_REPO>
cd <PASTA_DO_PROJETO>
npm install
```

### 1.3 Variaveis de ambiente (`.env.local`)

Copie `.env.example` para `.env.local` e preencha:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `ADMIN_EMAIL`
- `CRON_SECRET`
- `ENCRYPTION_KEY` (chave usada para criptografar App Key/App Secret Omie)
- `NEXT_PUBLIC_APP_URL` (recomendado para links de e-mail em producao)

Compatibilidade: `APP_SECRETS_ENCRYPTION_KEY` ainda funciona, mas o padrao atual e `ENCRYPTION_KEY`.

### 1.4 Rodar local

```bash
npm run dev
```

## 2. Supabase (migrations SQL)

Opcao CLI:

```bash
supabase db push
```

Opcao SQL Editor:

1. Execute os arquivos SQL da pasta `supabase/migrations` em ordem cronologica.
2. Execute o seed inicial de admin em `supabase/seeds/first_admin.sql` (troque o e-mail antes).

## 3. Primeiro admin no deploy inicial

1. Acesse `/login` com o e-mail que sera admin.
2. No Supabase SQL Editor, execute `supabase/seeds/first_admin.sql` ajustando `SEU_EMAIL_ADMIN@EMPRESA.COM`.
3. Confirme na tabela `public.users` se `role = 'admin'` e `active = true`.

## 4. Deploy na Vercel

## 4.1 Conectar projeto ao GitHub

1. Vercel Dashboard -> `Add New...` -> `Project`.
2. Importe o repositorio GitHub do Hero DRE Dashboard.
3. Framework detectado: Next.js.

### 4.2 Variaveis de ambiente na Vercel

Cadastre em `Settings -> Environment Variables`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `ADMIN_EMAIL`
- `CRON_SECRET`
- `ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL` (URL de producao)

### 4.3 Cron job

`vercel.json` ja esta configurado:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-all",
      "schedule": "0 6 * * *"
    }
  ]
}
```

`0 6 * * *` = 06:00 UTC (03:00 BRT).

### 4.4 Dominio customizado (se houver)

1. `Project -> Settings -> Domains`.
2. Adicione o dominio/subdominio.
3. Ajuste DNS no provedor.
4. Atualize `NEXT_PUBLIC_APP_URL` com o dominio final.

## 5. Cadastro de empresa Omie

1. Entrar como `admin`.
2. Ir em `/configuracoes` -> aba `Empresas`.
3. Clicar `Adicionar Empresa`.
4. Preencher `Nome`, `App Key`, `App Secret`.
5. Clicar `Testar Conexao`.
6. Clicar `Sincronizar`.

As credenciais Omie sao armazenadas criptografadas usando `ENCRYPTION_KEY`.

## 6. De-para de categorias (OMIE -> DRE)

1. Sincronize a empresa.
2. Abra `/mapeamento` ou a coluna de mapeamentos em `/configuracoes` -> `Estrutura DRE`.
3. Vincule cada categoria OMIE (`omie_category_code`) a uma conta DRE.
4. Categorias nao mapeadas entram em alerta por e-mail (Resend).

Sem mapeamento, os lancamentos da categoria nao entram corretamente no calculo da DRE.

## 7. Personalizar estrutura do DRE

1. Ir em `/configuracoes` -> aba `Estrutura DRE`.
2. Editar conta: nome, tipo, formula, ativo, ordenacao.
3. Reordenar com subir/descer.
4. Contas calculadas:
   - `type = calculado`
   - `is_summary = true`
   - formula obrigatoria
5. Exclusao:
   - nao permite excluir conta com filhos
   - pede confirmacao antes de excluir

## 8. Criar novos KPIs

1. Ir em `/configuracoes` -> aba `KPIs`.
2. `Novo KPI`:
   - nome
   - tipo (`value`, `percentage`, `ratio`)
   - contas do numerador
   - contas do denominador (opcional)
   - multiplicador (`100` para percentual)
3. Salvar e validar em `/kpis`.

## 9. Testes com dados reais (roteiro)

1. Cadastrar pelo menos 1 empresa Omie real.
2. Executar sync completa.
3. Mapear todas as categorias retornadas.
4. Conferir DRE vs Omie no mesmo periodo/unidade.
5. Testar drilldown ate o lancamento individual.
6. Testar KPIs e ranking.
7. Testar permissao por perfil:
   - `admin`: acesso total
   - `gestor_hero`: dashboard/kpis/conexoes
   - `gestor_unidade`: apenas dados da propria empresa

## 10. Troubleshooting

### Erro: `Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY`

- Falta configurar variaveis no `.env.local` (local) ou Vercel (producao).
- Reinicie o servidor apos alterar env.

### Erro de cookies no logout/login

- Garantir que operacoes de cookie acontecem apenas em Server Action/Route Handler.
- Validar callback de auth em `/auth/callback`.

### Loop para `/login` ao abrir menu/rotas

- Verificar registro na `public.users` (`active = true`, role correta).
- Confirmar middleware e regras de acesso por rota.

### Falha no cron (`401 Unauthorized`)

- Header deve ser `Authorization: Bearer <CRON_SECRET>`.
- Conferir se `CRON_SECRET` da Vercel e igual ao esperado pela API.

### Falha ao descriptografar credenciais Omie

- `ENCRYPTION_KEY` mudou apos dados ja criptografados.
- Solucao: restaurar chave original ou recadastrar credenciais das empresas.

## 11. Checklist go-live

- [ ] Todas as 9 empresas cadastradas
- [ ] Todas as categorias mapeadas
- [ ] Estrutura do DRE validada
- [ ] Usuarios criados com perfis corretos
- [ ] Cron job funcionando
- [ ] E-mails de alerta testados
- [ ] Backup do Supabase configurado
- [ ] SSL/dominio configurado

## 12. Validacao tecnica

```bash
npm run lint
npm run build
```
