// ============================================================================
// Leitura do formato da API da Sólides (Gestão de Pessoas) → linha de
// dp_colaboradores. Puro e testado: é aqui que moram as esquisitices do
// formato, conferidas contra a API real em 29/09/2026 —
//
//  - datas vêm como "DD/MM/AAAA" (inclusive o updated_at, que NÃO tem hora);
//  - salário vem como "R$ 3.500,00", e "R$ 0,00" quer dizer NÃO INFORMADO;
//  - a lista chama o departamento de `department` e a ficha de `departament`;
//  - CPF vem só com dígitos (`idNumber` na lista, `documents.idNumber` na ficha).
//
// Só entram os campos decididos pelo dono do projeto. Conta bancária, RG, PIS,
// CTPS, filiação e título de eleitor chegam na ficha e são DESCARTADOS aqui, de
// propósito — não acrescente sem decisão explícita.
// ============================================================================

export interface SolidesRef {
  id?: number | null;
  name?: string | null;
}

/** Item de GET /colaboradores (só o que usamos). */
export interface SolidesListItem {
  id: number;
  name?: string | null;
  idNumber?: string | null;
  email?: string | null;
  dateAdmission?: string | null;
  typeContract?: string | null;
  updated_at?: string | null;
  active?: boolean | null;
  senior?: SolidesRef | null;
  department?: SolidesRef | null;
  position?: SolidesRef | null;
  unity?: SolidesRef | null;
}

/** GET /colaboradores/{id} (só o que usamos). */
export interface SolidesDetail extends Omit<SolidesListItem, "department" | "idNumber"> {
  departament?: SolidesRef | null;
  dateDismissal?: string | null;
  salary?: string | null;
  address?: {
    zipCode?: string | null;
    streetName?: string | null;
    number?: string | null;
    additionalInformation?: string | null;
    neighborhood?: string | null;
    stateAcronym?: string | null;
    city?: { name?: string | null; state?: { name?: string | null; initials?: string | null } | null } | null;
  } | null;
  documents?: { idNumber?: string | null } | null;
}

export interface DpEndereco {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** Campos que vêm da LISTA (disponíveis para todos, mesmo se a ficha falhar). */
export interface DpColaboradorBase {
  solides_id: number;
  nome: string;
  cpf: string | null;
  email: string | null;
  unidade_id: number | null;
  unidade_nome: string | null;
  departamento_id: number | null;
  departamento_nome: string | null;
  cargo_id: number | null;
  cargo_nome: string | null;
  tipo_contrato: string | null;
  data_admissao: string | null;
  gestor_solides_id: number | null;
  gestor_nome: string | null;
  solides_atualizado_em: string | null;
}

/** Campos que só a FICHA traz. */
export interface DpColaboradorFicha {
  data_desligamento: string | null;
  salario: number | null;
  endereco: DpEndereco | null;
}

function text(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

function ref(r: SolidesRef | null | undefined): { id: number | null; nome: string | null } {
  const id = typeof r?.id === "number" && Number.isFinite(r.id) ? r.id : null;
  return { id, nome: id === null ? null : text(r?.name) };
}

/** "DD/MM/AAAA" → "AAAA-MM-DD". Vazio, formato estranho ou data impossível → null. */
export function parseDataBR(v: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (d.getUTCFullYear() !== Number(yyyy) || d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}`;
}

/** "R$ 3.500,00" → 3500. Zero, vazio ou ilegível → null (a Sólides usa R$ 0,00 para "não informado"). */
export function parseMoedaBR(v: string | null | undefined): number | null {
  const s = (v ?? "").replace(/R\$/i, "").replace(/\s/g, "");
  if (!/^-?[\d.]*,?\d*$/.test(s) || !/\d/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Só dígitos; aceita apenas 11 (CPF). */
export function parseCpf(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

export function parseListItem(item: SolidesListItem): DpColaboradorBase {
  const unidade = ref(item.unity);
  const depto = ref(item.department);
  const cargo = ref(item.position);
  const gestor = ref(item.senior);
  return {
    solides_id: item.id,
    nome: text(item.name) ?? `Colaborador ${item.id}`,
    cpf: parseCpf(item.idNumber),
    email: text(item.email)?.toLowerCase() ?? null,
    unidade_id: unidade.id,
    unidade_nome: unidade.nome,
    departamento_id: depto.id,
    departamento_nome: depto.nome,
    cargo_id: cargo.id,
    cargo_nome: cargo.nome,
    tipo_contrato: text(item.typeContract),
    data_admissao: parseDataBR(item.dateAdmission),
    gestor_solides_id: gestor.id,
    gestor_nome: gestor.nome,
    solides_atualizado_em: parseDataBR(item.updated_at),
  };
}

export function parseEndereco(a: SolidesDetail["address"]): DpEndereco | null {
  if (!a) return null;
  const cepDigits = (a.zipCode ?? "").replace(/\D/g, "");
  const out: DpEndereco = {
    cep: cepDigits.length === 8 ? cepDigits : null,
    logradouro: text(a.streetName),
    numero: text(a.number),
    complemento: text(a.additionalInformation),
    bairro: text(a.neighborhood),
    cidade: text(a.city?.name),
    uf: text(a.city?.state?.initials) ?? text(a.stateAcronym),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

export function parseDetail(d: SolidesDetail): DpColaboradorFicha {
  return {
    data_desligamento: parseDataBR(d.dateDismissal),
    salario: parseMoedaBR(d.salary),
    endereco: parseEndereco(d.address),
  };
}
