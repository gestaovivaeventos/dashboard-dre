# Leitura automática de anexo na nova requisição (NF e boleto)

**Data:** 2026-06-09
**Módulo:** Compras (ctrl) — tela Nova Requisição

## Objetivo

Ao anexar um documento na nova requisição, o sistema lê o conteúdo e preenche
campos automaticamente:
- **Nota fiscal** (quando "fornecedor emite nota fiscal? = Sim") → lê o **número
  da NF** e preenche um campo "Número da nota fiscal".
- **Boleto** (método de pagamento = Boleto) → lê **linha digitável/código de
  barras**, **favorecido** e **CPF/CNPJ** do beneficiário e preenche os campos.
- Ao marcar **Boleto**, o **upload do anexo vem ANTES** dos campos de dados
  (favorecido/CNPJ/código de barras), que são preenchidos após a leitura.

Campos preenchidos são **editáveis** (a leitura pode errar). Falha na leitura
nunca bloqueia o envio.

## Caveat técnico (acordado)

O código de barras do boleto **não** contém favorecido nem CNPJ. Esses dados
vêm do **texto do documento** (OCR), não do código de barras. O resultado é o
mesmo que o pedido; a fonte é a leitura do PDF/imagem.

## Capacidades existentes (reutilizar)

- `src/lib/contracts/landingai.ts` → `parseDocumentWithLandingAI(url)` extrai
  documento (PDF/imagem) para markdown via LandingAI (`VISION_AGENT_API_KEY`).
- `@ai-sdk/openai` + `generateObject` (gpt-4o-mini) para extrair estrutura a
  partir do markdown — padrão já usado em `src/lib/intelligence/*` e contratos.
- Bucket `ctrl-attachments` (RLS por `{auth.uid()}/`). Hoje o anexo é enviado no
  submit; passará a ser enviado **no momento do anexo** para permitir a leitura.

## Fluxo

```
Anexar arquivo (cliente)
  → upload imediato p/ ctrl-attachments ({uid}/{ts}-{nome}), guarda o path no estado
  → chama server action extractAttachmentData(path, kind)
        kind = "nota"   se supplier_issues_invoice === "sim"
        kind = "boleto" se payment_method === "boleto"
        (se nenhum dos dois, não lê)
  → action assina URL (service role) → parseDocumentWithLandingAI → markdown
  → generateObject(gpt-4o-mini, schema por kind) → campos
  → cliente preenche os campos (editáveis) + estado "lido"
Submit
  → se já há path enviado, reusa (não re-faz upload); senão faz como hoje
```

## Schemas de extração

- **nota**: `{ invoice_number: string | null }` — número da NF (de `nNF` ou da
  chave de acesso de 44 dígitos quando presente).
- **boleto**: `{ barcode: string | null, favorecido: string | null, cnpj_cpf: string | null }`
  — linha digitável (47–48 dígitos) ou código de barras (44), nome do
  beneficiário, e CNPJ/CPF do beneficiário.

## Modelo de dados

- `ctrl_requests.invoice_number text` (nullable). Preenchido a partir do campo
  "Número da nota fiscal". `createRequest` aceita e grava.

## Server action

`src/lib/ctrl/actions/attachment-ocr.ts`:
`extractAttachmentData(attachmentPath: string, kind: "nota" | "boleto")`
- Papéis: mesmos de quem cria requisição (solicitante/gerente/diretor/csc/admin).
- Assina URL do path (admin client, 5 min), chama LandingAI, depois gpt-4o-mini
  com o schema do `kind`. Retorna `{ data }` ou `{ error }` (erro não fatal).
- Timeout/erros de LandingAI/OpenAI → retorna `{ error }` legível; o cliente só
  mostra aviso e deixa os campos manuais.

## UI (nova-requisicao-form.tsx)

- Anexo passa a fazer **upload on-attach** (não só no submit). Estado do anexo
  guarda `{ file, path?, reading?, read? }`. Submit reutiliza `path` se existir.
- Após upload, dispara `extractAttachmentData` com o `kind` conforme contexto;
  estado de loading "Lendo documento…".
- **Número da nota fiscal**: campo novo, exibido quando `supplier_issues_invoice
  === "sim"`, preenchido pela leitura, editável.
- **Boleto**: quando `payment_method === "boleto"`, a seção de anexo é renderizada
  **antes** do bloco favorecido/CNPJ/código de barras. Os três campos são
  preenchidos pela leitura e continuam editáveis.
- Falha de leitura → aviso discreto ("Não consegui ler o documento, preencha
  manualmente"), campos vazios e editáveis.

## Fora de escopo

- Validar matematicamente o dígito verificador do boleto.
- Conferir se o CNPJ lido bate com o do fornecedor selecionado (fase futura).
- Limpeza de anexos órfãos (arquivos enviados e requisição abandonada).

## Riscos

- Custo por anexo (créditos LandingAI + tokens OpenAI). Aceitável (centavos).
- Latência de leitura (alguns segundos) — coberta por estado de loading; não
  bloqueia o resto do formulário.
- Precisão do OCR — mitigada por todos os campos serem editáveis.
