export interface ReportData {
  companyName: string;
  periodLabel: string;
  kpis: { label: string; value: string; change: string; changeType: "up" | "down" | "neutral" }[];
  aiAnalysis: {
    resumo: string;
    destaques_positivos: string[];
    pontos_atencao: string[];
    recomendacoes: string[];
  };
  budgetComparison?: { account: string; previsto: string; realizado: string; variacao: string; varType: "up" | "down" }[];
}

export interface ComparisonData {
  segmentName: string;
  periodLabel: string;
  aiAnalysis: {
    resumo: string;
    ranking: { empresa: string; destaque: string; score: "bom" | "atencao" | "critico" }[];
    padroes: string[];
    recomendacoes: string[];
  };
}

export interface ProjectionData {
  companyName: string;
  horizonLabel: string;
  aiAnalysis: {
    resumo: string;
    projecoes: {
      mes: string;
      receita: { otimista: number; realista: number; pessimista: number };
      margem_ebitda: { otimista: number; realista: number; pessimista: number };
    }[];
    premissas: string[];
    riscos: string[];
  };
}

function changeArrow(changeType: "up" | "down" | "neutral"): string {
  if (changeType === "up") return "&#9650;";
  if (changeType === "down") return "&#9660;";
  return "&#9654;";
}

function changeColor(changeType: "up" | "down" | "neutral"): string {
  if (changeType === "up") return "#16a34a";
  if (changeType === "down") return "#dc2626";
  return "#6b7280";
}

function formatCurrency(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
}

function formatPercent(n: number): string {
  return n.toFixed(1) + "%";
}

function baseWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatorio Financeiro</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          ${content}
          <tr>
            <td style="padding:24px 0 8px;text-align:center;font-size:12px;color:#94a3b8;">
              Este relatorio foi gerado automaticamente pelo Dashboard DRE.<br />
              Para suporte, entre em contato com o administrador do sistema.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderReportEmail(data: ReportData): string {
  const { companyName, periodLabel, kpis, aiAnalysis, budgetComparison } = data;

  const kpiCards = kpis.map((kpi) => {
    const arrow = changeArrow(kpi.changeType);
    const color = changeColor(kpi.changeType);
    return `
      <td style="width:50%;padding:8px;vertical-align:top;">
        <div style="background-color:#f8fafc;border-radius:8px;padding:16px;border:1px solid #e2e8f0;">
          <div style="font-size:12px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">${kpi.label}</div>
          <div style="font-size:22px;font-weight:700;color:#0f172a;margin-bottom:4px;">${kpi.value}</div>
          <div style="font-size:13px;color:${color};font-weight:500;">${arrow} ${kpi.change}</div>
        </div>
      </td>`;
  });

  const kpiRows: string[] = [];
  for (let i = 0; i < kpiCards.length; i += 2) {
    const pair = kpiCards.slice(i, i + 2);
    while (pair.length < 2) pair.push("<td style=\"width:50%;padding:8px;\"></td>");
    kpiRows.push(`<tr>${pair.join("")}</tr>`);
  }

  const positivesHtml = aiAnalysis.destaques_positivos
    .map(
      (item) =>
        `<li style="margin-bottom:8px;padding-left:4px;color:#166534;font-size:14px;line-height:1.5;">${item}</li>`
    )
    .join("");

  const warningsHtml = aiAnalysis.pontos_atencao
    .map(
      (item) =>
        `<li style="margin-bottom:8px;padding-left:4px;color:#991b1b;font-size:14px;line-height:1.5;">${item}</li>`
    )
    .join("");

  const recsHtml = aiAnalysis.recomendacoes
    .map(
      (item, idx) =>
        `<div style="display:flex;align-items:flex-start;margin-bottom:12px;">
          <div style="min-width:28px;height:28px;background-color:#1e40af;color:#ffffff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-right:12px;flex-shrink:0;line-height:28px;text-align:center;">${idx + 1}</div>
          <div style="font-size:14px;color:#1e3a8a;line-height:1.6;padding-top:4px;">${item}</div>
        </div>`
    )
    .join("");

  let budgetTableHtml = "";
  if (budgetComparison && budgetComparison.length > 0) {
    const rows = budgetComparison
      .map((row) => {
        const varColor = row.varType === "up" ? "#16a34a" : "#dc2626";
        const varArrow = row.varType === "up" ? "&#9650;" : "&#9660;";
        return `
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:10px 12px;font-size:13px;color:#334155;">${row.account}</td>
            <td style="padding:10px 12px;font-size:13px;color:#334155;text-align:right;">${row.previsto}</td>
            <td style="padding:10px 12px;font-size:13px;color:#334155;text-align:right;">${row.realizado}</td>
            <td style="padding:10px 12px;font-size:13px;font-weight:600;color:${varColor};text-align:right;">${varArrow} ${row.variacao}</td>
          </tr>`;
      })
      .join("");

    budgetTableHtml = `
      <tr>
        <td style="padding:0 0 24px;">
          <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Previsto x Realizado</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background-color:#f8fafc;">
                <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#64748b;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Conta</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#64748b;text-align:right;text-transform:uppercase;letter-spacing:0.05em;">Previsto</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#64748b;text-align:right;text-transform:uppercase;letter-spacing:0.05em;">Realizado</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#64748b;text-align:right;text-transform:uppercase;letter-spacing:0.05em;">Variacao</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>`;
  }

  const content = `
    <tr>
      <td style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);border-radius:12px 12px 0 0;padding:36px 32px;">
        <div style="font-size:11px;font-weight:600;color:#bfdbfe;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Relatorio DRE</div>
        <div style="font-size:26px;font-weight:800;color:#ffffff;margin-bottom:4px;">${companyName}</div>
        <div style="font-size:15px;color:#93c5fd;">${periodLabel}</div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:28px 32px 0;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:16px;">Indicadores do Periodo</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${kpiRows.join("")}
        </table>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:24px 32px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Analise do Periodo</div>
        <div style="font-size:14px;color:#475569;line-height:1.7;background-color:#f8fafc;border-left:4px solid #3b82f6;padding:16px;border-radius:0 8px 8px 0;">
          ${aiAnalysis.resumo}
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:50%;padding-right:12px;vertical-align:top;">
              <div style="background-color:#f0fdf4;border-radius:8px;padding:16px;border:1px solid #bbf7d0;">
                <div style="font-size:14px;font-weight:700;color:#15803d;margin-bottom:12px;">&#9989; Destaques Positivos</div>
                <ul style="margin:0;padding-left:16px;">
                  ${positivesHtml}
                </ul>
              </div>
            </td>
            <td style="width:50%;padding-left:12px;vertical-align:top;">
              <div style="background-color:#fef2f2;border-radius:8px;padding:16px;border:1px solid #fecaca;">
                <div style="font-size:14px;font-weight:700;color:#b91c1c;margin-bottom:12px;">&#9888; Pontos de Atencao</div>
                <ul style="margin:0;padding-left:16px;">
                  ${warningsHtml}
                </ul>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${budgetTableHtml}
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 28px;">
        <div style="background-color:#eff6ff;border-radius:8px;padding:20px;border:1px solid #bfdbfe;">
          <div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:16px;">&#128161; Recomendacoes</div>
          ${recsHtml}
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:0 32px 28px;">
        <div style="height:1px;background-color:#e2e8f0;margin-bottom:20px;"></div>
      </td>
    </tr>`;

  return baseWrapper(content);
}

export function renderComparisonEmail(data: ComparisonData): string {
  const { segmentName, periodLabel, aiAnalysis } = data;

  function scoreBadge(score: "bom" | "atencao" | "critico"): string {
    if (score === "bom") {
      return `<span style="display:inline-block;background-color:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:0.05em;">Bom</span>`;
    }
    if (score === "atencao") {
      return `<span style="display:inline-block;background-color:#fef3c7;color:#b45309;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:0.05em;">Atencao</span>`;
    }
    return `<span style="display:inline-block;background-color:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:0.05em;">Critico</span>`;
  }

  const rankingRows = aiAnalysis.ranking
    .map((item, idx) => {
      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:12px 16px;font-size:20px;font-weight:800;color:#7c3aed;text-align:center;width:48px;">${idx + 1}</td>
          <td style="padding:12px 16px;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px;">${item.empresa}</div>
            <div style="font-size:13px;color:#64748b;">${item.destaque}</div>
          </td>
          <td style="padding:12px 16px;text-align:center;white-space:nowrap;">${scoreBadge(item.score)}</td>
        </tr>`;
    })
    .join("");

  const padroesHtml = aiAnalysis.padroes
    .map(
      (item) =>
        `<li style="margin-bottom:8px;padding-left:4px;color:#5b21b6;font-size:14px;line-height:1.5;">${item}</li>`
    )
    .join("");

  const recsHtml = aiAnalysis.recomendacoes
    .map(
      (item, idx) =>
        `<div style="display:flex;align-items:flex-start;margin-bottom:12px;">
          <div style="min-width:28px;height:28px;background-color:#1e40af;color:#ffffff;border-radius:50%;font-size:13px;font-weight:700;margin-right:12px;flex-shrink:0;line-height:28px;text-align:center;">${idx + 1}</div>
          <div style="font-size:14px;color:#1e3a8a;line-height:1.6;padding-top:4px;">${item}</div>
        </div>`
    )
    .join("");

  const content = `
    <tr>
      <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);border-radius:12px 12px 0 0;padding:36px 32px;">
        <div style="font-size:11px;font-weight:600;color:#ddd6fe;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Analise Comparativa</div>
        <div style="font-size:26px;font-weight:800;color:#ffffff;margin-bottom:4px;">${segmentName}</div>
        <div style="font-size:15px;color:#c4b5fd;">${periodLabel}</div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:28px 32px 24px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Visao Geral do Grupo</div>
        <div style="font-size:14px;color:#475569;line-height:1.7;background-color:#f5f3ff;border-left:4px solid #7c3aed;padding:16px;border-radius:0 8px 8px 0;">
          ${aiAnalysis.resumo}
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 24px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Ranking de Desempenho</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background-color:#f8fafc;">
              <th style="padding:10px 16px;font-size:12px;font-weight:600;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:0.05em;width:48px;">#</th>
              <th style="padding:10px 16px;font-size:12px;font-weight:600;color:#64748b;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Empresa</th>
              <th style="padding:10px 16px;font-size:12px;font-weight:600;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
            </tr>
          </thead>
          <tbody>${rankingRows}</tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 24px;">
        <div style="background-color:#f5f3ff;border-radius:8px;padding:20px;border:1px solid #ddd6fe;">
          <div style="font-size:16px;font-weight:700;color:#7c3aed;margin-bottom:12px;">&#128202; Padroes Identificados</div>
          <ul style="margin:0;padding-left:16px;">
            ${padroesHtml}
          </ul>
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 28px;">
        <div style="background-color:#eff6ff;border-radius:8px;padding:20px;border:1px solid #bfdbfe;">
          <div style="font-size:16px;font-weight:700;color:#1e40af;margin-bottom:16px;">&#128161; Recomendacoes</div>
          ${recsHtml}
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:0 32px 28px;">
        <div style="height:1px;background-color:#e2e8f0;margin-bottom:20px;"></div>
      </td>
    </tr>`;

  return baseWrapper(content);
}

export function renderProjectionEmail(data: ProjectionData): string {
  const { companyName, horizonLabel, aiAnalysis } = data;

  const projectionRows = aiAnalysis.projecoes
    .map((proj) => {
      const mesFormatted = (() => {
        const [year, month] = proj.mes.split("-");
        const date = new Date(Number(year), Number(month) - 1, 1);
        return date.toLocaleString("pt-BR", { month: "short", year: "numeric" });
      })();

      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#0f172a;">${mesFormatted}</td>
          <td style="padding:10px 12px;font-size:13px;color:#16a34a;text-align:right;font-weight:600;">${formatCurrency(proj.receita.otimista)}</td>
          <td style="padding:10px 12px;font-size:13px;color:#0f172a;text-align:right;">${formatCurrency(proj.receita.realista)}</td>
          <td style="padding:10px 12px;font-size:13px;color:#dc2626;text-align:right;">${formatCurrency(proj.receita.pessimista)}</td>
          <td style="padding:10px 12px;font-size:13px;color:#16a34a;text-align:right;font-weight:600;">${formatPercent(proj.margem_ebitda.otimista)}</td>
          <td style="padding:10px 12px;font-size:13px;color:#0f172a;text-align:right;">${formatPercent(proj.margem_ebitda.realista)}</td>
          <td style="padding:10px 12px;font-size:13px;color:#dc2626;text-align:right;">${formatPercent(proj.margem_ebitda.pessimista)}</td>
        </tr>`;
    })
    .join("");

  const premissasHtml = aiAnalysis.premissas
    .map(
      (item) =>
        `<li style="margin-bottom:8px;padding-left:4px;color:#166534;font-size:14px;line-height:1.5;">${item}</li>`
    )
    .join("");

  const riscosHtml = aiAnalysis.riscos
    .map(
      (item) =>
        `<li style="margin-bottom:8px;padding-left:4px;color:#991b1b;font-size:14px;line-height:1.5;">${item}</li>`
    )
    .join("");

  const content = `
    <tr>
      <td style="background:linear-gradient(135deg,#059669 0%,#34d399 100%);border-radius:12px 12px 0 0;padding:36px 32px;">
        <div style="font-size:11px;font-weight:600;color:#a7f3d0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Projecao Financeira</div>
        <div style="font-size:26px;font-weight:800;color:#ffffff;margin-bottom:4px;">${companyName}</div>
        <div style="font-size:15px;color:#6ee7b7;">${horizonLabel}</div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:28px 32px 24px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Tendencia Geral</div>
        <div style="font-size:14px;color:#475569;line-height:1.7;background-color:#f0fdf4;border-left:4px solid #059669;padding:16px;border-radius:0 8px 8px 0;">
          ${aiAnalysis.resumo}
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 24px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">Cenarios de Projecao</div>
        <div style="overflow-x:auto;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;min-width:540px;">
            <thead>
              <tr style="background-color:#f8fafc;">
                <th rowspan="2" style="padding:10px 12px;font-size:11px;font-weight:600;color:#64748b;text-align:left;text-transform:uppercase;letter-spacing:0.05em;vertical-align:bottom;border-bottom:1px solid #e2e8f0;">Mes</th>
                <th colspan="3" style="padding:8px 12px 4px;font-size:11px;font-weight:600;color:#059669;text-align:center;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #d1fae5;">Receita</th>
                <th colspan="3" style="padding:8px 12px 4px;font-size:11px;font-weight:600;color:#0369a1;text-align:center;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e0f2fe;">Margem EBITDA</th>
              </tr>
              <tr style="background-color:#f8fafc;">
                <th style="padding:4px 12px 10px;font-size:11px;font-weight:500;color:#16a34a;text-align:right;border-bottom:1px solid #e2e8f0;">Otimista</th>
                <th style="padding:4px 12px 10px;font-size:11px;font-weight:500;color:#475569;text-align:right;border-bottom:1px solid #e2e8f0;">Realista</th>
                <th style="padding:4px 12px 10px;font-size:11px;font-weight:500;color:#dc2626;text-align:right;border-bottom:1px solid #e2e8f0;">Pessimista</th>
                <th style="padding:4px 12px 10px;font-size:11px;font-weight:500;color:#16a34a;text-align:right;border-bottom:1px solid #e2e8f0;">Otimista</th>
                <th style="padding:4px 12px 10px;font-size:11px;font-weight:500;color:#475569;text-align:right;border-bottom:1px solid #e2e8f0;">Realista</th>
                <th style="padding:4px 12px 10px;font-size:11px;font-weight:500;color:#dc2626;text-align:right;border-bottom:1px solid #e2e8f0;">Pessimista</th>
              </tr>
            </thead>
            <tbody>${projectionRows}</tbody>
          </table>
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:0 32px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width:50%;padding-right:12px;vertical-align:top;">
              <div style="background-color:#f0fdf4;border-radius:8px;padding:16px;border:1px solid #bbf7d0;">
                <div style="font-size:14px;font-weight:700;color:#15803d;margin-bottom:12px;">&#128204; Premissas</div>
                <ul style="margin:0;padding-left:16px;">
                  ${premissasHtml}
                </ul>
              </div>
            </td>
            <td style="width:50%;padding-left:12px;vertical-align:top;">
              <div style="background-color:#fef2f2;border-radius:8px;padding:16px;border:1px solid #fecaca;">
                <div style="font-size:14px;font-weight:700;color:#b91c1c;margin-bottom:12px;">&#9888; Riscos</div>
                <ul style="margin:0;padding-left:16px;">
                  ${riscosHtml}
                </ul>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:0 32px 28px;">
        <div style="height:1px;background-color:#e2e8f0;margin-bottom:20px;"></div>
      </td>
    </tr>`;

  return baseWrapper(content);
}
