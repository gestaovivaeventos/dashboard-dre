// ============================================================================
// Histórico de movimentações do DP. Puro e testado.
//
// A Sólides NÃO devolve histórico: a API só mostra o cadastro de hoje. Uma
// mudança de salário, cargo, empresa ou gestor só existe para o Control Hub se
// o espelho a perceber no momento em que a vê — comparando o que estava gravado
// com o que chegou. É isso que este módulo faz, e por isso ele roda DENTRO da
// sincronização, antes de sobrescrever a linha.
//
// Duas limitações que a tela tem de dizer, não esconder:
//  - a data do evento é a da DETECÇÃO (a sincronização diária), não a data em
//    que a mudança vale; o `updated_at` da Sólides só tem o dia;
//  - o que mudou antes do histórico existir não aparece em lugar nenhum.
// ============================================================================

import type { DpColaboradorBase, DpColaboradorFicha, DpEndereco } from "@/lib/dp/solides/parse";

export type DpCampoRastreado =
  | "nome"
  | "cpf"
  | "email"
  | "unidade"
  | "departamento"
  | "cargo"
  | "gestor"
  | "tipo_contrato"
  | "data_admissao"
  | "salario"
  | "data_desligamento"
  | "endereco"
  | "data_nascimento"
  | "experiencia_fim"
  | "dependentes"
  | "beneficios";

export type DpEventoTipo = "entrada" | "desligamento" | "reativacao" | "alteracao";

export interface DpEventoNovo {
  solides_id: number;
  tipo: DpEventoTipo;
  campo: DpCampoRastreado | null;
  valor_anterior: unknown;
  valor_novo: unknown;
}

/**
 * Versão do conjunto de campos que a sincronização grava hoje. Campo marcado
 * com `desde` maior que a versão já gravada na linha NÃO é comparado: na
 * primeira leitura dele não existe "antes", e comparar com o vazio da coluna
 * recém-criada registraria, por exemplo, "nascimento: — → 12/03/1990" para o
 * quadro inteiro. Ao acrescentar campo novo, suba a versão e marque o `desde`.
 */
export const FICHA_VERSAO_ATUAL = 2;

/** O que está gravado hoje (as colunas que o histórico compara). */
export type DpSnapshot = DpColaboradorBase & DpColaboradorFicha & { ativo: boolean; ficha_versao: number };

/** Campos da LISTA: sempre chegam, então sempre podem ser comparados. */
const CAMPOS_LISTA: Array<{ campo: DpCampoRastreado; valor: (c: DpColaboradorBase) => unknown; desde?: number }> = [
  { campo: "nome", valor: (c) => c.nome },
  { campo: "cpf", valor: (c) => c.cpf },
  { campo: "email", valor: (c) => c.email },
  // Unidade/departamento/cargo/gestor comparam pelo ID (renomear na Sólides não
  // é movimentação da pessoa), mas guardam o nome para a tela ser legível.
  { campo: "unidade", valor: (c) => (c.unidade_id === null ? null : { id: c.unidade_id, nome: c.unidade_nome }) },
  { campo: "departamento", valor: (c) => (c.departamento_id === null ? null : { id: c.departamento_id, nome: c.departamento_nome }) },
  { campo: "cargo", valor: (c) => (c.cargo_id === null ? null : { id: c.cargo_id, nome: c.cargo_nome }) },
  { campo: "gestor", valor: (c) => (c.gestor_solides_id === null ? null : { id: c.gestor_solides_id, nome: c.gestor_nome }) },
  { campo: "tipo_contrato", valor: (c) => c.tipo_contrato },
  { campo: "data_admissao", valor: (c) => c.data_admissao },
  { campo: "data_nascimento", valor: (c) => c.data_nascimento, desde: 2 },
];

/** Campos da FICHA: só comparados quando a ficha foi lida nesta execução. */
const CAMPOS_FICHA: Array<{ campo: DpCampoRastreado; valor: (c: DpColaboradorFicha) => unknown; desde?: number }> = [
  { campo: "salario", valor: (c) => c.salario },
  { campo: "data_desligamento", valor: (c) => c.data_desligamento },
  { campo: "endereco", valor: (c) => normalizarEndereco(c.endereco) },
  { campo: "experiencia_fim", valor: (c) => c.experiencia_fim, desde: 2 },
  // Listas comparadas inteiras (já vêm ordenadas por nome do parse).
  { campo: "dependentes", valor: (c) => c.dependentes ?? [], desde: 2 },
  { campo: "beneficios", valor: (c) => c.beneficios_solides ?? [], desde: 2 },
];

function normalizarEndereco(e: DpEndereco | null): DpEndereco | null {
  if (!e) return null;
  const out = { cep: e.cep, logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade, uf: e.uf };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

function chaveComparacao(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object" && "id" in (v as Record<string, unknown>)) return `id:${(v as { id: unknown }).id}`;
  if (typeof v === "number") return `n:${Math.round(v * 100)}`; // centavos: 3500 e 3500.00 são o mesmo salário
  return JSON.stringify(v);
}

/**
 * O que mudou de `antes` para `depois`. `ficha` null = a ficha não foi lida
 * agora, e os campos dela NÃO são comparados (o espelho manteve os anteriores;
 * compará-los com "nada" inventaria uma alteração).
 */
export function diffColaborador(
  antes: DpSnapshot,
  depois: DpColaboradorBase,
  ficha: DpColaboradorFicha | null,
): DpEventoNovo[] {
  const out: DpEventoNovo[] = [];
  const add = (campo: DpCampoRastreado, de: unknown, para: unknown) => {
    if (chaveComparacao(de) !== chaveComparacao(para)) {
      out.push({ solides_id: depois.solides_id, tipo: "alteracao", campo, valor_anterior: de ?? null, valor_novo: para ?? null });
    }
  };
  const lido = (desde?: number) => (desde ?? 1) <= (antes.ficha_versao ?? 1);
  for (const { campo, valor, desde } of CAMPOS_LISTA) if (lido(desde)) add(campo, valor(antes), valor(depois));
  if (ficha) for (const { campo, valor, desde } of CAMPOS_FICHA) if (lido(desde)) add(campo, valor(antes), valor(ficha));
  return out;
}

/**
 * Todos os eventos de uma execução.
 *
 * Primeira carga (nada gravado ainda) não gera evento nenhum: os 206 do dia 1
 * não "entraram" naquele dia, eles já estavam lá. Marcar todos como entrada
 * poluiria o histórico com uma admissão falsa por pessoa.
 */
export function eventosDaSincronizacao(input: {
  antes: Map<number, DpSnapshot>;
  lista: DpColaboradorBase[];
  fichas: Array<DpColaboradorFicha | null>;
  sumiram: Array<{ solidesId: number; ficha: DpColaboradorFicha | null }>;
}): DpEventoNovo[] {
  if (input.antes.size === 0) return [];
  const out: DpEventoNovo[] = [];
  input.lista.forEach((depois, i) => {
    const ficha = input.fichas[i] ?? null;
    const antes = input.antes.get(depois.solides_id);
    if (!antes) {
      out.push({ solides_id: depois.solides_id, tipo: "entrada", campo: null, valor_anterior: null, valor_novo: depois.data_admissao });
      return;
    }
    if (!antes.ativo) {
      out.push({ solides_id: depois.solides_id, tipo: "reativacao", campo: null, valor_anterior: null, valor_novo: depois.data_admissao });
    }
    out.push(...diffColaborador(antes, depois, ficha));
  });
  for (const s of input.sumiram) {
    out.push({
      solides_id: s.solidesId,
      tipo: "desligamento",
      campo: null,
      valor_anterior: null,
      valor_novo: s.ficha?.data_desligamento ?? null,
    });
  }
  return out;
}

// ── Leitura para a tela ─────────────────────────────────────────────────────

export const ROTULO_CAMPO: Record<DpCampoRastreado, string> = {
  nome: "Nome",
  cpf: "CPF",
  email: "E-mail",
  unidade: "Unidade",
  departamento: "Departamento",
  cargo: "Cargo",
  gestor: "Gestor",
  tipo_contrato: "Contrato",
  data_admissao: "Admissão",
  salario: "Salário",
  data_desligamento: "Data de desligamento",
  endereco: "Endereço",
  data_nascimento: "Data de nascimento",
  experiencia_fim: "Fim da experiência",
  dependentes: "Dependentes",
  beneficios: "Benefícios (Sólides)",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function dia(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Valor de um campo em texto curto para a linha do tempo. */
export function formatarValor(campo: DpCampoRastreado | null, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (campo === "salario") return typeof v === "number" ? BRL.format(v) : String(v);
  if (campo === "data_admissao" || campo === "data_desligamento" || campo === "data_nascimento" || campo === "experiencia_fim" || campo === null) {
    return dia(v) ?? String(v);
  }
  if (campo === "dependentes" || campo === "beneficios") {
    const lista = Array.isArray(v) ? (v as Array<{ nome?: string }>) : [];
    return lista.length === 0 ? "nenhum" : lista.map((x) => x.nome ?? "?").join(", ");
  }
  if (campo === "endereco" && typeof v === "object") {
    const e = v as DpEndereco;
    return [e.logradouro, e.numero, e.cidade, e.uf].filter(Boolean).join(", ") || "—";
  }
  if (typeof v === "object" && v && "nome" in v) return String((v as { nome: unknown }).nome ?? "—");
  return String(v);
}

/** Frase do evento: "Salário: R$ 3.000,00 → R$ 3.500,00", "Desligado (saída em 15/10/2026)". */
export function descreverEvento(e: { tipo: DpEventoTipo; campo: DpCampoRastreado | null; valor_anterior: unknown; valor_novo: unknown }): string {
  if (e.tipo === "entrada") return `Entrou no cadastro${dia(e.valor_novo) ? ` (admissão em ${dia(e.valor_novo)})` : ""}`;
  if (e.tipo === "reativacao") return "Voltou ao cadastro de ativos";
  if (e.tipo === "desligamento") {
    return `Saiu da lista de ativos da Sólides${dia(e.valor_novo) ? ` (desligamento em ${dia(e.valor_novo)})` : ""}`;
  }
  const campo = e.campo ?? "nome";
  return `${ROTULO_CAMPO[campo]}: ${formatarValor(campo, e.valor_anterior)} → ${formatarValor(campo, e.valor_novo)}`;
}
