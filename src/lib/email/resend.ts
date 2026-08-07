import { Resend } from "resend";

// ============================================================================
// Envio de e-mail via API do Resend.
//
// É o canal OBRIGATÓRIO dos relatórios BI (One Page Report) enviados aos
// gestores das unidades — cron mensal, envio manual pós-aceite e envio
// automático do dia 10. Também é o canal do lembrete diário de aprovações do
// Compras. O transporte antigo (SMTP do Gmail, em `@/lib/email/gmail`) segue
// existindo para os alertas internos ao admin.
//
// Config:
//   RESEND_API_KEY   ÚNICA variável obrigatória.
//   RESEND_FROM      OPCIONAL. Só para trocar o remetente padrão abaixo. Aceita
//                    "Nome <email>" ou só "email". Precisa ser de um domínio
//                    verificado no Resend — endereço de domínio não verificado
//                    é recusado pela API deles, não por este código.
//   EMAIL_FROM_NAME  OPCIONAL. Display name, quando o endereço vem sem nome.
//
// Por que existe um remetente padrão no código: o Resend não tem remetente
// genérico — todo envio exige um endereço de domínio verificado. Deixar isso
// só em variável de ambiente significou, na prática, relatório aceito pelo CSC
// que não saía (e rotina do dia 10 falhando em silêncio) porque a variável não
// tinha sido criada na Vercel. O domínio abaixo é o verificado do grupo; se um
// dia mudar, troque aqui ou defina RESEND_FROM.
// ============================================================================

/** Domínio verificado no Resend (resend.com/domains). */
const DEFAULT_FROM_DOMAIN = "contato.quokka.net.br";
/** Caixa usada como remetente dos e-mails automáticos. */
const DEFAULT_FROM_MAILBOX = "bi";

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

function fromName(): string {
  return process.env.EMAIL_FROM_NAME?.trim() || "Control Hub";
}

/**
 * Remetente efetivo. Nunca é nulo: sem RESEND_FROM cai no domínio verificado
 * padrão. Aceita "Nome <email>" (usado como veio) ou só "email".
 */
export function resolveFrom(): string {
  const raw = process.env.RESEND_FROM?.trim();
  if (raw) {
    if (raw.includes("<")) return raw;
    return `${fromName()} <${raw}>`;
  }
  return `${fromName()} <${DEFAULT_FROM_MAILBOX}@${DEFAULT_FROM_DOMAIN}>`;
}

/** True quando o Resend está configurado (basta a chave da API). */
export function isResendConfigured(): boolean {
  return Boolean(getClient());
}

export interface ResendConfigStatus {
  ok: boolean;
  hasApiKey: boolean;
  /** Remetente que será usado no envio — exibido para conferência. */
  from: string;
  /** Nomes das variáveis que faltam, para a mensagem na tela. */
  missing: string[];
  /** Explicação pronta para o usuário (nula quando está tudo certo). */
  message: string | null;
}

/**
 * Estado da configuração de envio. Serve para a tela avisar ANTES de o usuário
 * aceitar e clicar em "Enviar" — descobrir que o canal não está configurado
 * só no momento do envio é tarde demais no fluxo mensal.
 */
export function resendConfigStatus(): ResendConfigStatus {
  const hasApiKey = Boolean(process.env.RESEND_API_KEY?.trim());

  return {
    ok: hasApiKey,
    hasApiKey,
    from: resolveFrom(),
    missing: hasApiKey ? [] : ["RESEND_API_KEY"],
    message: hasApiKey
      ? null
      : "Envio por e-mail indisponível: falta RESEND_API_KEY nas variáveis de ambiente. " +
        "Defina no projeto da Vercel e REIMPLANTE — variável nova só passa a valer em um deploy novo, " +
        "não no que já está no ar.",
  };
}

/**
 * O Resend recusa qualquer envio partindo de domínio não verificado, e a
 * mensagem dele é em inglês e não diz o que fazer. Como o remetente agora vem
 * de um padrão no código, esse é o erro mais provável quando o DNS do domínio
 * ainda não propagou — vale traduzir em vez de repassar cru.
 */
function explainSendError(message: string, from: string): string {
  if (/not verified|domain is not verified|verify your domain/i.test(message)) {
    return (
      `${message} — o remetente em uso é ${from}. ` +
      "Verifique o domínio em resend.com/domains (registros DNS) ou defina RESEND_FROM " +
      "com um endereço de outro domínio já verificado."
    );
  }
  return message;
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
        "RESEND_API_KEY não configurada — o envio do relatório BI exige a API do Resend. " +
        "Defina a chave nas variáveis de ambiente do projeto na Vercel e REIMPLANTE.",
    };
  }

  const from = resolveFrom();

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
      const message = explainSendError(
        error.message || "Falha desconhecida no Resend.",
        from,
      );
      console.error("[resend] Falha no envio:", message);
      return { ok: false, error: message };
    }

    console.log("[resend] Enviado para:", recipients.join(", "), "id:", data?.id);
    return { ok: true, id: data?.id };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Erro inesperado no Resend.";
    const message = explainSendError(raw, from);
    console.error("[resend] Falha no envio:", message);
    return { ok: false, error: message };
  }
}
