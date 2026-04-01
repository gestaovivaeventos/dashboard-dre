import { sendEmail } from "@/lib/email/gmail";

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

export async function sendSyncFailureEmail(failures: SyncFailureItem[]) {
  if (failures.length === 0) return;

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

  const companyList = failures
    .map((f) => `<li><strong>${f.companyName}</strong>: ${f.error}</li>`)
    .join("");

  await sendEmail({
    to: adminEmail,
    subject: `[Controll Hub] Falha na sincronizacao — ${failures.length} empresa(s)`,
    html: `
      <h2>Falha na Sincronizacao</h2>
      <p>${failures.length} empresa(s) apresentaram erro durante a sincronizacao com o Omie:</p>
      <ul>${companyList}</ul>
      <p><a href="${appUrl}/admin">Abrir Painel Administrador</a></p>
    `,
  });
}

export async function sendUnmappedCategoriesEmail(items: UnmappedCategoryItem[]) {
  if (items.length === 0) return;

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

  const grouped = new Map<string, UnmappedCategoryItem[]>();
  items.forEach((item) => {
    const list = grouped.get(item.companyName) ?? [];
    list.push(item);
    grouped.set(item.companyName, list);
  });

  let body = "<h2>Categorias Omie sem Mapeamento DRE</h2>";
  grouped.forEach((cats, companyName) => {
    body += `<h3>${companyName}</h3><ul>`;
    cats.forEach((c) => {
      body += `<li><code>${c.code}</code> — ${c.description}</li>`;
    });
    body += "</ul>";
  });
  body += `<p><a href="${appUrl}/mapeamento">Abrir Mapeamento</a></p>`;

  await sendEmail({
    to: adminEmail,
    subject: `[Controll Hub] ${items.length} categoria(s) sem mapeamento DRE`,
    html: body,
  });
}
