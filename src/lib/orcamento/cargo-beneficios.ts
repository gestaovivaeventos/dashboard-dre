import { BENEFICIOS, type Beneficios } from "@/lib/orcamento/beneficios";

// =============================================================================
// Os benefícios que o Plano de Cargos define — e o que acontece com eles quando
// o gestor escolhe o cargo de um colaborador.
//
// O plano já dispensava digitar o SALÁRIO pessoa a pessoa; o resto do pacote
// continuava sendo 7 células × N pessoas, toda vez que alguém entra no quadro.
// Agora o nível carrega os dois.
//
// Módulo PURO (sem "use server"): a mesma regra vale no cliente (a tela mostra
// o que vai acontecer) e no servidor.
// =============================================================================

/** Benefícios todos nulos — "o plano não define nenhum". */
export function beneficiosVazios(): Beneficios {
  const out = {} as Beneficios;
  for (const b of BENEFICIOS) out[b.key] = null;
  return out;
}

/** Normaliza um objeto parcial (vindo do banco ou de um input) em `Beneficios`.
 * Valor não finito ou negativo vira `null` — nunca um número inválido. */
export function normalizarBeneficios(
  parcial?: Partial<Beneficios> | null,
): Beneficios {
  const out = {} as Beneficios;
  for (const b of BENEFICIOS) {
    const v = parcial?.[b.key];
    out[b.key] = v == null || !Number.isFinite(v) || v < 0 ? null : v;
  }
  return out;
}

/** O plano diz alguma coisa sobre este nível? (algum benefício preenchido) */
export function planoDefineAlgum(beneficios?: Partial<Beneficios> | null): boolean {
  return BENEFICIOS.some((b) => beneficios?.[b.key] != null);
}

/** Soma mensal dos benefícios definidos. Nulo não entra (não é zero). */
export function somaBeneficios(beneficios?: Partial<Beneficios> | null): number {
  return BENEFICIOS.reduce((acc, b) => acc + (beneficios?.[b.key] ?? 0), 0);
}

/** Quantos dos 7 o plano define. */
export function quantosDefinidos(beneficios?: Partial<Beneficios> | null): number {
  return BENEFICIOS.filter((b) => beneficios?.[b.key] != null).length;
}

/**
 * Benefícios do colaborador depois de escolher um cargo do plano.
 *
 * A regra tem duas metades, e as duas foram pedidas:
 *
 * 1. **O que o plano define, SOBRESCREVE** — exatamente como já acontece com o
 *    salário. Escolher "Analista — Pleno" traz o pacote do Pleno por inteiro,
 *    mesmo que a célula já tivesse um valor digitado à mão; senão o plano
 *    valeria só para quem entra no quadro pela primeira vez, e mudar alguém de
 *    nível deixaria o benefício do nível antigo para trás, em silêncio.
 *
 * 2. **O que o plano NÃO define, PRESERVA** — nulo no nível é "o plano não diz",
 *    e o valor segue vindo da aba Benefícios, digitado pelo administrador.
 *    Zerar aqui seria apagar um cadastro que ninguém pediu para apagar, e
 *    tiraria da tela o único vestígio de que ele existia.
 *
 * É por isso que nulo e 0 precisam continuar distintos no banco: 0 é "esta
 * pessoa não recebe" (e sobrescreve), nulo é "o plano não diz" (e preserva).
 *
 * O valor é COPIADO, não referenciado: `orcamento_pessoal_colaboradores` guarda
 * um retrato. Editar o plano em novembro não mexe em quem já está no quadro.
 */
export function beneficiosAoEscolherCargo(
  atuais: Partial<Beneficios> | null | undefined,
  doNivel: Partial<Beneficios> | null | undefined,
): Beneficios {
  const out = normalizarBeneficios(atuais);
  const plano = normalizarBeneficios(doNivel);
  for (const b of BENEFICIOS) {
    if (plano[b.key] != null) out[b.key] = plano[b.key];
  }
  return out;
}

/** As chaves que a escolha do cargo mudaria. Vazio = nada a gravar. */
export function beneficiosQueMudam(
  atuais: Partial<Beneficios> | null | undefined,
  doNivel: Partial<Beneficios> | null | undefined,
): string[] {
  const antes = normalizarBeneficios(atuais);
  const depois = beneficiosAoEscolherCargo(atuais, doNivel);
  return BENEFICIOS.filter((b) => antes[b.key] !== depois[b.key]).map((b) => b.key);
}
