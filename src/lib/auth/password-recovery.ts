// ============================================================================
// E-mail de recuperação de senha — gerado e enviado PELO APP.
//
// Por que não usar `supabase.auth.resetPasswordForEmail` (que era o caminho
// anterior): o e-mail sai do GoTrue com o link
// `.../auth/v1/verify?token=...&type=recovery&redirect_to=<destino>`. Quando o
// `redirect_to` não está na allowlist de Redirect URLs do projeto Supabase, o
// GoTrue SILENCIOSAMENTE troca o destino pelo Site URL — e o usuário cai na
// raiz/login em vez da tela de redefinição, sem mensagem de erro nenhuma. Meia
// correção morava fora do repositório (painel do Supabase), então qualquer
// mudança de domínio quebrava tudo de novo.
//
// Aqui o link é montado por nós: pegamos o `hashed_token` via
// `auth.admin.generateLink` (que NÃO dispara e-mail) e apontamos direto para
// `/redefinir-senha?token_hash=...&type=recovery`. A página troca o token por
// sessão com `verifyOtp`. Nada de `redirect_to`, nada de Site URL, nada de
// PKCE — o link funciona inclusive quando aberto em outro navegador/celular,
// que era outro modo de falha do fluxo antigo.
//
// O envio usa o Resend (mesmo canal do relatório BI e do lembrete de
// aprovações).
// ============================================================================

import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailViaResend } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PasswordRecoveryResult {
  /** True quando o e-mail saiu OU quando o endereço simplesmente não existe. */
  ok: boolean;
  /** Preenchido só em falha real de infraestrutura (para o log do servidor). */
  error?: string;
}

const FF = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";

const C = {
  ground: "#e9e6e4",
  card: "#fbfaf9",
  ink: "#201e1d",
  body: "#6b6663",
  footerText: "#a9a4a1",
  accent: "#ec3013",
} as const;

/** Erro do GoTrue que significa "esse e-mail não tem conta" — não é falha. */
function isUnknownUser(message: string, status?: number): boolean {
  return status === 404 || /user not found|user_not_found/i.test(message);
}

export function passwordRecoverySubject(): string {
  return "Control Hub - Redefinição de senha";
}

export function passwordRecoveryEmailHtml(link: string): string {
  // Mesmas regras de HTML de e-mail do lembrete de aprovações: só tabelas,
  // coluna única, estilo inline, sem imagem/web font/JS.
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.ground};">
<div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;">Link para criar uma nova senha de acesso ao Control Hub.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ground};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.card};">
      <tr><td style="background:${C.accent};padding:18px 32px;font-family:${FF};font-size:13px;line-height:18px;mso-line-height-rule:exactly;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;font-weight:700;">Control Hub</td></tr>
      <tr><td style="padding:32px 32px 0;font-family:${FF};font-size:22px;line-height:28px;mso-line-height-rule:exactly;color:${C.ink};font-weight:700;">Redefinição de senha</td></tr>
      <tr><td style="padding:14px 32px 0;font-family:${FF};font-size:15px;line-height:23px;mso-line-height-rule:exactly;color:${C.body};">
        Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha.
      </td></tr>
      <tr><td style="padding:24px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${C.ink};"><a href="${link}" style="display:inline-block;padding:14px 26px;font-family:${FF};font-size:15px;line-height:18px;mso-line-height-rule:exactly;color:#ffffff;text-decoration:none;font-weight:700;">Criar nova senha</a></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 32px 0;font-family:${FF};font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:${C.body};">
        O link vale por tempo limitado e só pode ser usado uma vez. Se o botão não funcionar, copie e cole este endereço no navegador:
      </td></tr>
      <tr><td style="padding:8px 32px 0;font-family:${FF};font-size:12px;line-height:18px;mso-line-height-rule:exactly;color:${C.accent};word-break:break-all;">${link}</td></tr>
      <tr><td style="padding:24px 32px 0;"><div style="border-top:1px solid #e0dddb;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td style="padding:16px 32px 32px;font-family:${FF};font-size:13px;line-height:20px;mso-line-height-rule:exactly;color:${C.body};">
        Se não foi você quem pediu, ignore esta mensagem — sua senha atual continua valendo.
      </td></tr>
      <tr><td style="background:${C.ink};padding:18px 32px;font-family:${FF};font-size:12px;line-height:18px;mso-line-height-rule:exactly;color:${C.footerText};">
        Control Hub · mensagem automática, não responda.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Gera o token de recuperação e envia o e-mail com o link para
 * `/redefinir-senha`.
 *
 * NUNCA revela se o e-mail existe na base: endereço desconhecido volta
 * `{ ok: true }` igual a um envio bem-sucedido (a tela mostra a mesma
 * mensagem genérica nos dois casos).
 */
export async function sendPasswordRecoveryEmail(
  rawEmail: string,
): Promise<PasswordRecoveryResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Informe um e-mail válido." };
  }

  const appUrl = resolveAppUrl().replace(/\/+$/, "");

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SUPABASE_SERVICE_ROLE_KEY ausente.",
    };
  }

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email,
    // Só preenche o `action_link` que não usamos — o nosso link é montado a
    // partir do hashed_token. Fica aqui por coerência do registro no GoTrue.
    options: { redirectTo: `${appUrl}/redefinir-senha` },
  });

  if (error) {
    if (isUnknownUser(error.message, error.status)) {
      // Conta inexistente: silêncio proposital, resposta genérica.
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }

  const hashedToken = data?.properties?.hashed_token;
  if (!hashedToken) {
    return { ok: false, error: "O Supabase não devolveu o token de recuperação." };
  }

  const link = `${appUrl}/redefinir-senha?token_hash=${encodeURIComponent(
    hashedToken,
  )}&type=recovery`;

  const sent = await sendEmailViaResend({
    to: email,
    subject: passwordRecoverySubject(),
    html: passwordRecoveryEmailHtml(link),
  });

  if (!sent.ok) {
    return { ok: false, error: sent.error ?? "Falha ao enviar o e-mail." };
  }

  return { ok: true };
}
