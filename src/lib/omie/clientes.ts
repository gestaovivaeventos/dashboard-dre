import { omieCall, OMIE_CLIENTES_URL } from "@/lib/omie/client";
import { parseBanco } from "@/lib/ctrl/bancos";
import { ESTADO_EXTERIOR } from "@/lib/ctrl/paises";

/** Cadastro do Omie normalizado (usado no pull Omie → banco local do Case). */
export interface OmiePartner {
  omie_codigo: number;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  chave_pix: string | null;
  endereco: string | null;
  cidade_estado: string | null;
  cep: string | null;
  tags: string[];
}

function nn(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/** @internal exportado para teste. */
export function mapCadastro(c: Record<string, unknown>): OmiePartner {
  const banc = (c.dadosBancarios as Record<string, unknown> | undefined) ?? {};
  const ddd = String(c.telefone1_ddd ?? "").trim();
  const num = String(c.telefone1_numero ?? "").trim();
  const cidade = nn(c.cidade);
  const estado = nn(c.estado);
  const cidadeEstado = cidade && estado ? `${cidade} / ${estado}` : cidade ?? estado;
  const codBanco = nn(banc.codigo_banco);
  return {
    omie_codigo: Number(c.codigo_cliente_omie),
    name: nn(c.razao_social) ?? nn(c.nome_fantasia) ?? "(sem nome)",
    cnpj_cpf: nn(c.cnpj_cpf),
    pessoa_fisica: String(c.pessoa_fisica ?? "").toUpperCase() === "S",
    email: nn(c.email),
    phone: ddd || num ? `${ddd}${num}` : null,
    banco: codBanco,
    agencia: nn(banc.agencia),
    conta_corrente: nn(banc.conta_corrente),
    titular_banco: nn(banc.nome_titular),
    doc_titular: nn(banc.doc_titular),
    chave_pix: nn(banc.cChavePix),
    endereco: nn(c.endereco),
    cidade_estado: cidadeEstado,
    cep: nn(c.cep),
    tags: Array.isArray(c.tags)
      ? (c.tags as Array<Record<string, unknown>>).map((t) => String(t.tag ?? "")).filter(Boolean)
      : [],
  };
}

/**
 * Lê TODOS os cadastros de clientes/fornecedores de uma unidade Omie
 * (ListarClientes paginado). Retorna vazio se a conta não tiver cadastros.
 */
export async function listAllClientesFromOmie(
  appKey: string,
  appSecret: string,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<OmiePartner[]> {
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 200; // teto de segurança (~100k cadastros)
  const out: OmiePartner[] = [];

  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const res = await omieCall(OMIE_CLIENTES_URL, "ListarClientes", appKey, appSecret, {
      pagina,
      registros_por_pagina: pageSize,
      apenas_importado_api: "N",
    });
    if (res.notFound) break;
    const arr = (res.data.clientes_cadastro as Array<Record<string, unknown>> | undefined) ?? [];
    for (const c of arr) {
      if (c?.codigo_cliente_omie) out.push(mapCadastro(c));
    }
    const totalPaginas = Number(res.data.total_de_paginas ?? 1);
    if (pagina >= totalPaginas || arr.length === 0) break;
  }
  return out;
}

export interface OmieSupplierData {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  /** Quando difere da razão social (ex.: fundo de formatura em cadastro PF do responsável). */
  nome_fantasia?: string | null;
  email: string | null;
  phone: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  chave_pix: string | null;
  /** "Usar transferência como método de pagamento padrão" — vira transf_padrao "S"/"N". */
  transf_padrao?: boolean;
  // Fornecedor estrangeiro: a Omie recebe estado="EX" (Exterior) + codigo_pais
  // (tabela BACEN) e o campo cnpj_cpf vazio (a interface mostra "Estrangeiro").
  estrangeiro?: boolean;
  codigo_pais?: string | null;
  estado?: string | null;
  cidade?: string | null;
  endereco?: string | null;
  endereco_numero?: string | null;
  complemento?: string | null;
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function buildClientePayload(
  supplier: OmieSupplierData,
  tag: string = "Fornecedor",
): Record<string, unknown> {
  const doc = onlyDigits(supplier.cnpj_cpf);
  const phone = onlyDigits(supplier.phone);
  const payload: Record<string, unknown> = {
    codigo_cliente_integracao: supplier.id,
    razao_social: supplier.name,
    nome_fantasia: supplier.nome_fantasia?.trim() || supplier.name,
    // Estrangeiro é sempre PJ. O CNPJ/CPF é OMITIDO (a Omie desabilita o campo
    // para cadastros do exterior e exibe "Estrangeiro"); enviar vazio pode ser
    // rejeitado como documento inválido.
    pessoa_fisica: supplier.estrangeiro ? "N" : doc.length === 11 ? "S" : "N",
    email: supplier.email ?? "",
    tags: [{ tag }],
  };
  if (!supplier.estrangeiro) {
    payload.cnpj_cpf = doc;
  } else {
    // A Omie trata o cadastro como do exterior quando estado="EX". O país vem
    // no codigo_pais (BACEN); cidade/endereço são texto livre do exterior.
    payload.estado = (supplier.estado ?? ESTADO_EXTERIOR).trim() || ESTADO_EXTERIOR;
    if (supplier.codigo_pais?.trim()) payload.codigo_pais = supplier.codigo_pais.trim();
    if (supplier.cidade?.trim()) payload.cidade = supplier.cidade.trim();
    if (supplier.endereco?.trim()) payload.endereco = supplier.endereco.trim();
    if (supplier.endereco_numero?.trim()) payload.endereco_numero = supplier.endereco_numero.trim();
    if (supplier.complemento?.trim()) payload.complemento = supplier.complemento.trim();
  }
  if (phone.length >= 10) {
    payload.telefone1_ddd = phone.slice(0, 2);
    payload.telefone1_numero = phone.slice(2);
  }
  // dadosBancarios aceita a chave PIX no campo `cChavePix` (string60). Enviamos
  // quando houver dados bancários OU chave PIX — fornecedor só-PIX também precisa
  // ter a chave gravada no Omie para o pagamento automático.
  const chavePix = (supplier.chave_pix ?? "").trim();
  if (supplier.banco || supplier.agencia || supplier.conta_corrente || chavePix) {
    payload.dadosBancarios = {
      // O banco é gravado como "código - nome" (ex.: "336 - C6 Bank"). onlyDigits
      // grudava os dígitos do NOME no código ("3366"); parseBanco extrai só o
      // código numérico real e ainda cobre cadastros legados pelo nome.
      codigo_banco: parseBanco(supplier.banco)?.codigo ?? "",
      agencia: supplier.agencia ?? "",
      // Conta crua (preserva o traço/dígito verificador). onlyDigits grudava o
      // dígito no número (ex.: "20377589-9" → "203775899"), parecendo incompleto
      // no Omie. A agência já vai crua; a conta segue o mesmo padrão.
      conta_corrente: (supplier.conta_corrente ?? "").trim(),
      doc_titular: onlyDigits(supplier.doc_titular) || doc,
      nome_titular: supplier.titular_banco ?? supplier.name,
      cChavePix: chavePix,
      // "Definir transferência como forma de pagamento padrão" no Omie ("S"/"N").
      transf_padrao: supplier.transf_padrao ? "S" : "N",
    };
  }
  return payload;
}

/**
 * Monta o payload Omie de um CLIENTE do Case a partir da linha de case_clients.
 * Cliente sem CNPJ (ex.: fundo de formatura) vira PESSOA FÍSICA no Omie: CPF e
 * nome do responsável legal, com o fundo/razão social no nome fantasia.
 * Retorna null quando não há documento nenhum (nem CNPJ, nem CPF do responsável).
 */
export function clienteRowToOmieData(row: {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  phone: string | null;
  resp_legal?: string | null;
  cpf_resp_legal?: string | null;
}): OmieSupplierData | null {
  const base = {
    id: row.id,
    email: row.email,
    phone: row.phone,
    banco: null,
    agencia: null,
    conta_corrente: null,
    titular_banco: null,
    doc_titular: null,
    chave_pix: null,
  };
  if (onlyDigits(row.cnpj_cpf)) {
    return { ...base, name: row.name, cnpj_cpf: row.cnpj_cpf };
  }
  if (onlyDigits(row.cpf_resp_legal)) {
    return {
      ...base,
      name: (row.resp_legal ?? "").trim() || row.name,
      cnpj_cpf: row.cpf_resp_legal ?? null,
      nome_fantasia: row.name,
    };
  }
  return null;
}

// Cadastra/atualiza o fornecedor em UMA unidade Omie, sem duplicar:
//   1. Procura por CNPJ (cobre legado e re-sync) → AlterarCliente (por
//      codigo_cliente_omie, SEM código de integração — ver nota abaixo).
//   2. Não achou → IncluirCliente (com código de integração = supplier.id).
// Fornecedor estrangeiro não tem CNPJ: a busca de duplicata é pelo código de
// integração (supplier.id) via ConsultarCliente, garantindo idempotência no
// re-sync sem depender do documento.
export async function syncSupplierToOmieUnit(
  appKey: string,
  appSecret: string,
  supplier: OmieSupplierData,
  tag: string = "Fornecedor",
): Promise<{ codigoCliente: number }> {
  const doc = onlyDigits(supplier.cnpj_cpf);
  if (!doc && !supplier.estrangeiro) {
    throw new Error("Cadastro sem CNPJ/CPF — não é possível cadastrar no Omie.");
  }

  let existingCode: number | null = null;
  if (doc) {
    // Fluxo brasileiro: dedupe por CNPJ/CPF (cobre legado e re-sync).
    const list = await omieCall(OMIE_CLIENTES_URL, "ListarClientes", appKey, appSecret, {
      pagina: 1,
      registros_por_pagina: 50,
      clientesFiltro: { cnpj_cpf: doc },
    });
    if (!list.notFound) {
      const arr =
        (list.data.clientes_cadastro as Array<Record<string, unknown>> | undefined) ?? [];
      const match = arr.find((c) => onlyDigits(String(c.cnpj_cpf ?? "")) === doc) ?? arr[0];
      if (match?.codigo_cliente_omie) existingCode = Number(match.codigo_cliente_omie);
    }
  } else {
    // Estrangeiro (sem documento): dedupe pelo código de integração. Quando o
    // cliente ainda não existe, a Omie NÃO devolve o "não encontrado" padrão —
    // lança "Cliente não cadastrado para o Código [0]", que o omieCall trata
    // como erro. Capturamos essa mensagem e seguimos para o IncluirCliente
    // (primeiro cadastro). Qualquer outro erro (rede, credenciais…) propaga.
    try {
      const consulta = await omieCall(OMIE_CLIENTES_URL, "ConsultarCliente", appKey, appSecret, {
        codigo_cliente_integracao: supplier.id,
      });
      if (!consulta.notFound) {
        existingCode = Number(consulta.data.codigo_cliente_omie) || null;
      }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const isNotFound =
        /n[ãa]o cadastrado|n[ãa]o encontrado|not found|c[óo]digo \[?0\]?/.test(msg);
      if (!isNotFound) throw err;
    }
  }

  const fields = buildClientePayload(supplier, tag);

  if (existingCode) {
    // Identifica só por codigo_cliente_omie. NÃO enviar codigo_cliente_integracao:
    // num cliente legado que ainda não tem esse código, a Omie tenta resolver por
    // ele e falha ("Cliente não cadastrado para o Código de Integração [uuid]").
    const alterFields = { ...fields };
    delete alterFields.codigo_cliente_integracao;
    const res = await omieCall(OMIE_CLIENTES_URL, "AlterarCliente", appKey, appSecret, {
      ...alterFields,
      codigo_cliente_omie: existingCode,
    });
    return { codigoCliente: Number((res.data.codigo_cliente_omie as number) ?? existingCode) };
  }

  const res = await omieCall(OMIE_CLIENTES_URL, "IncluirCliente", appKey, appSecret, fields);
  const code = Number(res.data.codigo_cliente_omie as number);
  if (!code) throw new Error("Omie não retornou codigo_cliente_omie ao incluir.");
  return { codigoCliente: code };
}

// Cadastra/atualiza o CLIENTE (contratante) numa unidade Omie — mesma mecânica
// idempotente do fornecedor, mas com a tag "Cliente".
export async function syncClienteToOmieUnit(
  appKey: string,
  appSecret: string,
  cliente: OmieSupplierData,
): Promise<{ codigoCliente: number }> {
  return syncSupplierToOmieUnit(appKey, appSecret, cliente, "Cliente");
}
