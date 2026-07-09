// Chave PIX: tipo + formatação exigida pelo Omie (campo único cChavePix).
// Doc Omie: CPF/CNPJ sem pontuação; telefone +55DDDNÚMERO; e-mail normal;
// aleatória ~36 caracteres.

export type PixTipo = "cpf_cnpj" | "telefone" | "email" | "aleatoria";

export const PIX_TIPOS: Array<{ value: PixTipo; label: string; placeholder: string }> = [
  { value: "cpf_cnpj", label: "CPF / CNPJ", placeholder: "Só números" },
  { value: "telefone", label: "Telefone / Celular", placeholder: "+55 DDD número" },
  { value: "email", label: "E-mail", placeholder: "nome@dominio.com" },
  { value: "aleatoria", label: "Chave aleatória", placeholder: "chave de ~36 caracteres" },
];

const onlyDigits = (s: string) => (s ?? "").replace(/\D/g, "");

/** Formata a chave PIX para o padrão que o Omie espera, conforme o tipo. */
export function formatPixForOmie(tipo: PixTipo | null | undefined, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  switch (tipo) {
    case "cpf_cnpj":
      return onlyDigits(v);
    case "telefone": {
      const d = onlyDigits(v);
      // Sem código do país → assume Brasil (+55). Com 55 na frente, usa como está.
      const nums = d.startsWith("55") && d.length > 11 ? d : `55${d}`;
      return `+${nums}`;
    }
    case "email":
      return v.toLowerCase();
    case "aleatoria":
    default:
      return v;
  }
}

/** Valida a chave PIX conforme o tipo. Retorna a mensagem de erro (PT) ou null. */
export function validatePix(tipo: PixTipo | null | undefined, raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null; // chave PIX é opcional
  if (!tipo) return "Selecione o tipo da chave PIX.";
  switch (tipo) {
    case "cpf_cnpj": {
      const d = onlyDigits(v);
      if (d.length !== 11 && d.length !== 14) return "Chave PIX CPF/CNPJ deve ter 11 (CPF) ou 14 (CNPJ) dígitos.";
      return null;
    }
    case "telefone": {
      const d = onlyDigits(v).replace(/^55/, "");
      if (d.length < 10 || d.length > 11) return "Chave PIX telefone deve ter DDD + número (10 ou 11 dígitos).";
      return null;
    }
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Chave PIX e-mail inválida.";
      return null;
    case "aleatoria":
      if (v.replace(/-/g, "").length < 20) return "Chave PIX aleatória parece curta demais (confira).";
      return null;
    default:
      return null;
  }
}
