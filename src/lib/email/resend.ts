import { Resend } from "resend";

// ============================================================================
// Envio de e-mail via API do Resend.
//
// É o canal OBRIGATÓRIO dos relatórios BI (One Page Report) enviados aos
// gestores das unidades — cron mensal, envio manual pós-aceite e envio
// automático do dia 10. O transporte antigo (SMTP do Gmail, em
// `@/lib/email/gmail`) segue existindo para os alertas internos ao admin.
//
// Config:
//   RESEND_API_KEY   obrigatório (sem ele o envio falha explicitamente — não
//                    cai em fallback silencioso, que mascararia o problema).
//   RESEND_FROM      remetente completo, ex.: "Control Hub <bi@empresa.com.br>".
//                    Precisa ser de um domínio verificado no Resend.
//   EMAIL_FROM_NAME  usado apenas para compor o display name quando RESEND_FROM
//                    traz só o endereço.
// ============================================================================

export interface SendResendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendResendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

let client: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

/** Remetente configurado. Aceita "Nome <email>" ou só "email". */
function resolveFrom(): string | null {
  const raw = process.env.RESEND_FROM?.trim();
  if (!raw) return null;
  if (raw.includes("<")) return raw;
  const name = process.env.EMAIL_FROM_NAME?.trim() || "Control Hub";
  return `${name} <${raw}>`;
}

/** True quando o Resend está configurado (chave + remetente). */
export function isResendConfigured(): boolean {
  return Boolean(getClient() && resolveFrom());
}

export interface ResendConfigStatus {
  ok: boolean;
  hasApiKey: boolean;
  hasFrom: boolean;
  /** Nomes das variáveis que faltam, para a mensagem na tela. */
  missing: string[];
  /** Explicação pronta para o usuário (vazia quando está tudo certo). */
  message: string | null;
}

/**
 * Estado da configuração de envio. Serve para a tela avisar ANTES de o usuário
 * aceitar e clicar em "Enviar" — descobrir que o canal não está configurado
 * só no momento do envio é tarde demais no fluxo mensal.
 */
export function resendConfigStatus(): ResendConfigStatus {
  const hasApiKey = Boolean(process.env.RESEND_API_KEY?.trim());
  const hasFrom = Boolean(resolveFrom());
  const missing: string[] = [];
  if (!hasApiKey) missing.push("RESEND_API_KEY");
  if (!hasFrom) missing.push("RESEND_FROM");

  return {
    ok: hasApiKey && hasFrom,
    hasApiKey,
    hasFrom,
    missing,
    message: missing.length
      ? `Envio por e-mail indisponível: falta ${missing.join(" e ")} nas variáveis de ambiente. ` +
        "Defina no projeto da Vercel e REIMPLANTE — variável nova só passa a valer em um deploy novo, " +
        "não no que já está no ar. O remetente (RESEND_FROM) precisa ser de um domínio verificado no Resend."
      : null,
  };
}

/**
 * Envia um e-mail pelo Resend. NUNCA lança: devolve `{ ok, error }` para o
 * caller registrar o status/falha (exigência dos logs de envio do relatório).
 */
export async function sendEmailViaResend({
  to,
  subject,
  html,
  replyTo,
}: SendResendEmailOptions): Promise<SendResendEmailResult> {
  const resend = getClient();
  if (!resend) {
    return {
      ok: false,
      error:
        "RESEND_API_KEY não configurada — o envio do relatório BI exige a API do Resend.",
    };
  }

  const from = resolveFrom();
  if (!from) {
    return {
      ok: false,
      error:
        'RESEND_FROM não configurado. Não basta a chave da API: o Resend exige um remetente de domínio verificado. ' +
        'Defina RESEND_FROM (ex.: "Control Hub <bi@empresa.com.br>") nas variáveis de ambiente do projeto na Vercel ' +
        "e REIMPLANTE — variável nova não vale para o deploy que já está no ar.",
    };
  }

  // Lista de destinatários deduplicada e normalizada. Endereço vazio na lista
  // faz a API inteira falhar — e um envio de relatório não pode cair por causa
  // de uma linha malformada no cadastro.
  const recipients = Array.from(
    new Set(
      (Array.isArray(to) ? to : [to])
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0),
    ),
  );
  if (recipients.length === 0) {
    return { ok: false, error: "Nenhum destinatário válido informado." };
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: recipients,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      const message = error.message || "Falha desconhecida no Resend.";
      console.error("[resend] Falha no envio:", message);
      return { ok: false, error: message };
    }

    console.log("[resend] Enviado para:", recipients.join(", "), "id:", data?.id);
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro inesperado no Resend.";
    console.error("[resend] Falha no envio:", message);
    return { ok: false, error: message };
  }
}
