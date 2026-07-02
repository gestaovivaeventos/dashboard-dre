// Formatadores de saída do contrato Case — não confiam no dado cru (aplicam
// máscara de CNPJ/CPF/CEP e formato monetário/data brasileiro na renderização).

const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Retorna o valor formatado, ou string vazia se ausente (nunca "{{campo}}"). */
export function fmtCNPJ(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length !== 14) return (v ?? "").trim();
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function fmtCPF(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length !== 11) return (v ?? "").trim();
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

/** CPF ou CNPJ conforme a quantidade de dígitos. */
export function fmtDoc(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length === 14) return fmtCNPJ(v);
  if (d.length === 11) return fmtCPF(v);
  return (v ?? "").trim();
}

export function fmtCEP(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (d.length !== 8) return (v ?? "").trim();
  return d.replace(/^(\d{2})(\d{3})(\d{3})$/, "$1.$2-$3");
}

const nfBRL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.234,56" (sem o "R$", que fica no layout). */
export function fmtNumber(v: number | null | undefined): string {
  return nfBRL.format(Number(v) || 0);
}

/** "R$ 1.234,56". */
export function fmtBRL(v: number | null | undefined): string {
  return `R$ ${fmtNumber(v)}`;
}

/** dd/mm/aaaa. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(iso).trim();
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** "19 de março de 2025" (data de assinatura). */
export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(iso).trim();
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
