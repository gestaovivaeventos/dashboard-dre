import { Resend } from "resend";

interface SyncFailureItem {
  companyId: string;
  companyName: string;
  error: string;
}

interface UnmappedCategoryItem {
  companyId: string;
  companyName: string;
  code: string;
  description: string;
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!apiKey || !adminEmail) {
    return null;
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return { apiKey, adminEmail, appUrl };
}

export async function sendSyncFailureEmail(failures: SyncFailureItem[]) {
  if (failures.length === 0) return;
  const config = getResendConfig();
  if (!config) return;

  const resend = new Resend(config.apiKey);
  const list = failures
    .map(
      (item) =>
        `<li><strong>${item.companyName}</strong> (${item.companyId}): ${item.error}</li>`,
    )
    .join("");

  await resend.emails.send({
    from: "Hero DRE Dashboard <onboarding@resend.dev>",
    to: config.adminEmail,
    subject: "Sincronizacao Hero DRE Dashboard - Falhas",
    html: `
      <h2>Sincronizacao Hero DRE Dashboard</h2>
      <p>Uma ou mais empresas falharam no processo de sincronizacao diaria.</p>
      <ul>${list}</ul>
      <p><a href="${config.appUrl}/conexoes">Abrir painel de conexoes</a></p>
    `,
  });
}

export async function sendUnmappedCategoriesEmail(items: UnmappedCategoryItem[]) {
  if (items.length === 0) return;
  const config = getResendConfig();
  if (!config) return;

  const resend = new Resend(config.apiKey);
  const grouped = new Map<string, UnmappedCategoryItem[]>();
  items.forEach((item) => {
    const key = `${item.companyId}::${item.companyName}`;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  });

  const sections = Array.from(grouped.entries())
    .map(([key, categories]) => {
      const [, companyName] = key.split("::");
      const rows = categories
        .map((category) => `<li>${category.code} - ${category.description}</li>`)
        .join("");
      return `<h3>${companyName}</h3><ul>${rows}</ul>`;
    })
    .join("");

  await resend.emails.send({
    from: "Hero DRE Dashboard <onboarding@resend.dev>",
    to: config.adminEmail,
    subject: "Sincronizacao Hero DRE Dashboard - Novas categorias sem mapeamento",
    html: `
      <h2>Sincronizacao Hero DRE Dashboard</h2>
      <p>Foram encontradas novas categorias OMIE sem mapeamento.</p>
      ${sections}
      <p><a href="${config.appUrl}/mapeamento">Abrir tela de mapeamento</a></p>
    `,
  });
}
