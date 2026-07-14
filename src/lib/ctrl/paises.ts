// Tabela de países (código BACEN, 4 dígitos) usada pela Omie no campo
// `codigo_pais` de clientes/fornecedores estrangeiros. É a MESMA tabela do
// cPais da NF-e/CT-e (ex.: Brasil = 1058). A Omie marca o cadastro como
// estrangeiro quando o `estado` é "EX" (Exterior) e o `codigo_pais` aponta
// para um país diferente de 1058.
//
// Mantemos apenas os países mais comuns para plataformas/serviços
// internacionais. Novos países: acrescente o par { codigo, nome } com o
// código BACEN correto (não o ISO numérico — Brasil é 1058, não 076).

export interface PaisBacen {
  /** Código BACEN (cPais) com 4 dígitos, como a Omie espera. */
  codigo: string;
  nome: string;
}

// Estado (UF) que a Omie usa para marcar o cadastro como estrangeiro.
export const ESTADO_EXTERIOR = "EX";
export const ESTADO_EXTERIOR_LABEL = "EX - Exterior";

// Código do Brasil — referência para NUNCA aparecer na lista de estrangeiros.
export const CODIGO_PAIS_BRASIL = "1058";

// Ordenada alfabeticamente pelo nome (pt-BR). Brasil de propósito fora — a
// opção "estrangeiro" só faz sentido para países que não o Brasil.
export const PAISES_EXTERIOR: PaisBacen[] = [
  { codigo: "0230", nome: "Alemanha" },
  { codigo: "0639", nome: "Argentina" },
  { codigo: "0698", nome: "Austrália" },
  { codigo: "0728", nome: "Áustria" },
  { codigo: "0876", nome: "Bélgica" },
  { codigo: "0973", nome: "Bolívia" },
  { codigo: "1490", nome: "Canadá" },
  { codigo: "1589", nome: "Chile" },
  { codigo: "1600", nome: "China" },
  { codigo: "1694", nome: "Colômbia" },
  { codigo: "1902", nome: "Coreia do Sul" },
  { codigo: "2321", nome: "Dinamarca" },
  { codigo: "2445", nome: "Emirados Árabes Unidos" },
  { codigo: "2453", nome: "Espanha" },
  { codigo: "2496", nome: "Estados Unidos" },
  { codigo: "2755", nome: "França" },
  { codigo: "5738", nome: "Holanda (Países Baixos)" },
  { codigo: "3611", nome: "Índia" },
  { codigo: "3751", nome: "Irlanda" },
  { codigo: "3832", nome: "Israel" },
  { codigo: "3867", nome: "Itália" },
  { codigo: "3999", nome: "Japão" },
  { codigo: "4936", nome: "México" },
  { codigo: "5380", nome: "Noruega" },
  { codigo: "5860", nome: "Paraguai" },
  { codigo: "5894", nome: "Peru" },
  { codigo: "6076", nome: "Portugal" },
  { codigo: "6289", nome: "Reino Unido" },
  { codigo: "7412", nome: "Singapura" },
  { codigo: "7641", nome: "Suécia" },
  { codigo: "7676", nome: "Suíça" },
  { codigo: "8451", nome: "Uruguai" },
];

const NOME_POR_CODIGO = new Map(PAISES_EXTERIOR.map((p) => [p.codigo, p.nome]));

/** Nome do país a partir do código BACEN (ou null se desconhecido). */
export function paisNomeByCodigo(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  return NOME_POR_CODIGO.get(codigo.trim()) ?? null;
}

/** true se o código BACEN existe na lista de países do exterior. */
export function isCodigoPaisExterior(codigo: string | null | undefined): boolean {
  const c = codigo?.trim();
  return !!c && c !== CODIGO_PAIS_BRASIL && NOME_POR_CODIGO.has(c);
}
