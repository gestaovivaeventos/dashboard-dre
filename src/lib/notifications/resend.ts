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

interface UnmappedEntryItem {
  companyName: string;
  categoryCode: string;
  categoryName: string;
  entryCount: number;
  totalValue: number;
  oldestPayment: string;
  newestPayment: string;
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

// ===========================================================================
// Alerta de entries existentes em financial_entries que ficaram invisiveis
// no Dashboard DRE por nao terem mapeamento de categoria. Sao a causa raiz
// principal do sintoma "drilldown mostra X, dashboard mostra menos".
// ===========================================================================
export async function sendUnmappedEntriesAlertEmail(items: UnmappedEntryItem[]) {
  if (items.length === 0) return;

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

  const fmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const grouped = new Map<string, UnmappedEntryItem[]>();
  items.forEach((item) => {
    const list = grouped.get(item.companyName) ?? [];
    list.push(item);
    grouped.set(item.companyName, list);
  });

  let body =
    "<h2>Lancamentos invisiveis no Dashboard DRE</h2>" +
    "<p>Os lancamentos abaixo estao em <code>financial_entries</code> mas nao " +
    "aparecem em nenhuma linha da DRE porque a categoria Omie nao tem " +
    "mapeamento configurado. Esta e a causa principal de divergencias entre " +
    "o total do Drilldown e o valor da celula do Dashboard.</p>";

  let totalGeral = 0;
  grouped.forEach((rows, companyName) => {
    body += `<h3>${companyName}</h3>`;
    body += "<table border='1' cellpadding='6' style='border-collapse:collapse'>";
    body += "<tr><th>Categoria</th><th>Qtd</th><th>Total</th><th>Periodo</th></tr>";
    rows.forEach((r) => {
      totalGeral += r.totalValue;
      body += `<tr>
        <td><code>${r.categoryCode}</code> ${r.categoryName ? `&mdash; ${r.categoryName}` : ""}</td>
        <td style='text-align:right'>${r.entryCount}</td>
        <td style='text-align:right'>${fmt.format(r.totalValue)}</td>
        <td>${r.oldestPayment} a ${r.newestPayment}</td>
      </tr>`;
    });
    body += "</table>";
  });

  body += `<p><strong>Total invisivel: ${fmt.format(totalGeral)}</strong></p>`;
  body += `<p><a href="${appUrl}/mapeamento">Configurar mapeamento</a></p>`;

  await sendEmail({
    to: adminEmail,
    subject: `[Controll Hub] ${items.length} grupo(s) de lancamentos invisiveis no Dashboard`,
    html: body,
  });
}
