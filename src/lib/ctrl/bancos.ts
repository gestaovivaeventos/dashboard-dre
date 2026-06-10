// Lista curada dos bancos mais usados no Brasil para o select de cadastro
// de fornecedor. O valor armazenado em ctrl_suppliers.banco é a string
// "código - nome" para que a busca no nova-requisicao-form continue
// funcionando independente do formato exato.

export interface Banco {
  codigo: string;
  nome: string;
}

export const BANCOS_BR: Banco[] = [
  { codigo: "001", nome: "Banco do Brasil" },
  { codigo: "033", nome: "Santander" },
  { codigo: "104", nome: "Caixa Econômica Federal" },
  { codigo: "237", nome: "Bradesco" },
  { codigo: "341", nome: "Itaú Unibanco" },
  { codigo: "041", nome: "Banrisul" },
  { codigo: "077", nome: "Banco Inter" },
  { codigo: "212", nome: "Banco Original" },
  { codigo: "260", nome: "Nu Pagamentos (Nubank)" },
  { codigo: "290", nome: "PagSeguro / PagBank" },
  { codigo: "323", nome: "Mercado Pago" },
  { codigo: "336", nome: "C6 Bank" },
  { codigo: "208", nome: "BTG Pactual" },
  { codigo: "422", nome: "Banco Safra" },
  { codigo: "070", nome: "BRB - Banco de Brasília" },
  { codigo: "748", nome: "Sicredi" },
  { codigo: "756", nome: "Sicoob" },
  { codigo: "655", nome: "Banco Votorantim" },
  { codigo: "246", nome: "Banco ABC Brasil" },
  { codigo: "364", nome: "Gerencianet" },
  { codigo: "380", nome: "PicPay" },
  { codigo: "335", nome: "Banco Digio" },
  { codigo: "197", nome: "Stone Pagamentos" },
  { codigo: "274", nome: "Money Plus" },
  { codigo: "318", nome: "Banco BMG" },
  { codigo: "389", nome: "Banco Mercantil do Brasil" },
  { codigo: "633", nome: "Banco Rendimento" },
  { codigo: "707", nome: "Banco Daycoval" },
  { codigo: "037", nome: "Banco do Estado do Pará (Banpará)" },
  { codigo: "085", nome: "Cooperativa Central de Crédito - Ailos" },
  { codigo: "184", nome: "Banco Itaú BBA" },
  { codigo: "218", nome: "Banco BS2" },
  { codigo: "655", nome: "Neon Pagamentos" },
];

// Formato armazenado em ctrl_suppliers.banco
export function formatBanco(banco: Banco): string {
  return `${banco.codigo} - ${banco.nome}`;
}

// Tenta inverter: dado "237 - Bradesco" devolve { codigo: "237", nome: "Bradesco" }
// Usado pra pré-selecionar o select no modo edição.
export function parseBanco(stored: string | null | undefined): Banco | null {
  if (!stored) return null;
  const match = stored.match(/^(\d{3})\s*-\s*(.+)$/);
  if (match) return { codigo: match[1], nome: match[2].trim() };
  // Compatibilidade com cadastros antigos sem código — busca pelo nome
  const byName = BANCOS_BR.find((b) => b.nome.toLowerCase() === stored.toLowerCase());
  if (byName) return byName;
  return null;
}

// ─── Tipos de chave PIX ─────────────────────────────────────────────────────

export type PixKeyType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export interface PixKeyTypeOption {
  value: PixKeyType;
  label: string;
  placeholder: string;
  // Hint shown below the input
  hint: string;
}

// A Omie só aceita chave PIX de telefone no formato internacional "+55DDDNUMERO".
// Normaliza qualquer entrada (com/sem +55, com máscara) para esse formato.
export function normalizePixTelefone(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let digits = s.replace(/\D/g, "");
  if (!digits) return "";
  // Remove o código do país se já veio embutido (55 + 10/11 dígitos nacionais).
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  return `+55${digits}`;
}

export const PIX_KEY_TYPES: PixKeyTypeOption[] = [
  {
    value: "cpf",
    label: "CPF",
    placeholder: "000.000.000-00",
    hint: "Somente para pessoa física. 11 dígitos.",
  },
  {
    value: "cnpj",
    label: "CNPJ",
    placeholder: "00.000.000/0000-00",
    hint: "Somente para pessoa jurídica. 14 dígitos.",
  },
  {
    value: "email",
    label: "E-mail",
    placeholder: "contato@empresa.com",
    hint: "E-mail cadastrado no banco como chave PIX.",
  },
  {
    value: "telefone",
    label: "Telefone",
    placeholder: "+55 11 99999-9999",
    hint: "Celular com +55 na frente (ex: +5511999999999) — a Omie só aceita nesse formato.",
  },
  {
    value: "aleatoria",
    label: "Chave aleatória",
    placeholder: "abc12345-6789-...",
    hint: "Identificador único gerado pelo banco (formato UUID).",
  },
];
