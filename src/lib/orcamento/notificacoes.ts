import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { sendEmailViaResend } from "@/lib/email/resend";
import { ORCAMENTO_MODULE } from "@/lib/auth/orcamento";
import { ESTADO_LABEL, type CicloTransicao } from "@/lib/orcamento/ciclo";

/**
 * Avisos por e-mail das transições do ciclo do orçamento.
 *
 * Três momentos, três públicos:
 *  - **enviado para validação** → os DIRETORES da empresa: é o único aviso que
 *    inicia trabalho de alguém (sem ele, o orçamento fica esperando que alguém
 *    lembre de olhar);
 *  - **validação concluída** → os construtores dos setores da empresa: é o
 *    retorno chegando;
 *  - **orçamento concluído / publicado** → quem participou do ciclo.
 *
 * ── Best-effort, sempre ────────────────────────────────────────────────────
 * Falha de e-mail NÃO derruba a transição. O ciclo é o fato; o aviso é
 * conveniência, e a tela mostra o estado de qualquer maneira. Mesmo critério do
 * módulo Case ("falha de e-mail não derruba a ação").
 *
 * ── Destinatário resolvido no SERVIDOR ─────────────────────────────────────
 * Nunca vem do cliente — mesma regra dos relatórios BI. Aqui sai de
 * `user_company_access` (a empresa) cruzado com o perfil e a concessão do
 * módulo: quem não tem o módulo não recebe aviso de um orçamento que não pode
 * abrir.
 */

interface Destinatario {
  email: string;
  nome: string | null;
}

/**
 * Quem tem o módulo Orçamento, o perfil pedido e acesso à empresa.
 *
 * `perfis` vazio = qualquer perfil elegível. O vínculo com a empresa é
 * obrigatório: admin sem `user_company_access` não recebe, de propósito — o
 * aviso é operacional, não supervisão.
 */
async function destinatarios(
  companyId: string,
  perfis: string[],
): Promise<Destinatario[]> {
  const admin = createAdminClientIfAvailable();
  if (!admin) return [];

  const { data } = await admin
    .from("users")
    .select(
      "id, email, name, profile, active, user_company_access(company_id), " +
        "user_module_roles!user_module_roles_user_id_fkey(module)",
    )
    .eq("active", true);

  const out: Destinatario[] = [];
  for (const u of (data ?? []) as unknown as Array<{
    email: string | null;
    name: string | null;
    profile: string | null;
    user_company_access: Array<{ company_id: string }> | null;
    user_module_roles: Array<{ module: string | null }> | null;
  }>) {
    if (!u.email) continue;
    if (perfis.length > 0 && !perfis.includes(u.profile ?? "")) continue;
    const temModulo =
      (u.user_module_roles ?? []).some((r) => r?.module === ORCAMENTO_MODULE) ||
      u.profile === "admin";
    if (!temModulo) continue;
    const naEmpresa = (u.user_company_access ?? []).some((c) => c.company_id === companyId);
    if (!naEmpresa) continue;
    out.push({ email: u.email, nome: u.name });
  }
  return out;
}

function corpo(titulo: string, linhas: string[], link: string): string {
  // HTML inline e simples, pelo mesmo motivo dos relatórios: cliente de e-mail
  // ignora <style> e o que importa aqui é chegar legível.
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">',
    `<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${titulo}</p>`,
    ...linhas.map((l) => `<p style="margin:0 0 8px">${l}</p>`),
    `<p style="margin:16px 0 0"><a href="${link}" style="color:#0b7a5b;font-weight:bold">Abrir o orçamento</a></p>`,
    "</div>",
  ].join("");
}

/**
 * Avisa quem precisa saber de uma transição. Devolve quantos e-mails saíram —
 * útil para o log, mas o chamador ignora o resultado de propósito.
 */
export async function avisarTransicao(params: {
  companyId: string;
  companyName: string;
  year: number;
  transicao: CicloTransicao;
  estadoNovo: string;
  autorNome: string | null;
  motivo?: string | null;
}): Promise<{ enviados: number }> {
  const { companyId, companyName, year, transicao, autorNome, motivo } = params;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = `${base}/orcamento/empresa/${companyId}/${year}`;

  let alvo: Destinatario[] = [];
  let titulo = "";
  const linhas: string[] = [];

  if (transicao === "enviar_validacao" || transicao === "reenviar") {
    // Diretoria: é o aviso que INICIA o trabalho dela.
    alvo = await destinatarios(companyId, ["diretor"]);
    titulo = `Orçamento ${year} de ${companyName} aguarda sua validação`;
    linhas.push(
      transicao === "reenviar"
        ? "O orçamento voltou com os ajustes e está pronto para uma nova rodada de validação."
        : "O orçamento foi montado e enviado para a validação da diretoria.",
    );
  } else if (transicao === "concluir_validacao") {
    // Construtores: o retorno chegou.
    alvo = await destinatarios(companyId, ["gerente", "gerente_setor"]);
    titulo = `Validação do orçamento ${year} de ${companyName} concluída`;
    linhas.push(
      "A diretoria terminou a revisão. Veja o que mudou e o que depende de você em “Retorno da diretoria”.",
    );
  } else if (transicao === "concluir" || transicao === "publicar") {
    alvo = await destinatarios(companyId, ["diretor", "gerente", "gerente_setor"]);
    titulo =
      transicao === "publicar"
        ? `Orçamento ${year} de ${companyName} publicado`
        : `Orçamento ${year} de ${companyName} concluído`;
    linhas.push(
      transicao === "publicar"
        ? "O orçamento foi publicado e já aparece no Budget e Forecast."
        : "O orçamento foi fechado. Falta apenas publicar no Budget e Forecast.",
    );
  } else {
    // Reabrir não avisa ninguém: é conserto do administrador, e um e-mail a
    // cada reabertura viraria ruído que ensina a ignorar os outros.
    return { enviados: 0 };
  }

  if (alvo.length === 0) return { enviados: 0 };

  if (autorNome) linhas.push(`<span style="color:#666">Por ${autorNome}.</span>`);
  if (motivo?.trim()) linhas.push(`<span style="color:#666">Observação: “${motivo.trim()}”</span>`);

  const res = await sendEmailViaResend({
    to: alvo.map((d) => d.email),
    subject: titulo,
    html: corpo(titulo, linhas, link),
  });

  if (!res.ok) {
    console.error("[orcamento] falha ao avisar transição:", res.error);
    return { enviados: 0 };
  }
  return { enviados: alvo.length };
}

/** Rótulo do estado, reexportado para quem monta texto de aviso. */
export { ESTADO_LABEL };
