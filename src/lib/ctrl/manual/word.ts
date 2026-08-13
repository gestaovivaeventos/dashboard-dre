// Gera o Manual do módulo Compras como documento do Word (.doc).
//
// Formato: HTML "Word-compatible" (MSO). O Word e o Google Docs abrem esse
// arquivo como documento editável, preservando títulos, tabelas, cores e
// quebras de página — sem precisar de biblioteca de .docx no projeto.
//
// O conteúdo vem inteiro de ./content — este arquivo só sabe DESENHAR. Se o
// manual precisa mudar, mude lá.
//
// Único consumidor: scripts/gen-manual-doc.ts. A tela /ctrl/manual não oferece
// download — o Word é distribuído fora do app.

import {
  MANUAL_AUDIENCES,
  MANUAL_ORG,
  MANUAL_SECTIONS,
  MANUAL_SUBTITLE,
  MANUAL_TITLE,
  MANUAL_UPDATED_AT,
  MANUAL_VERSION,
  type ManualBlock,
  type ManualTone,
} from "./content";

export const MANUAL_DOC_FILENAME = "Manual-Modulo-Compras-Control-Hub.doc";

const TONE: Record<ManualTone, { bg: string; border: string; text: string; tag: string }> = {
  info: { bg: "#EEF2FF", border: "#6366F1", text: "#3730A3", tag: "Nota" },
  sucesso: { bg: "#ECFDF5", border: "#10B981", text: "#065F46", tag: "OK" },
  atencao: { bg: "#FFFBEB", border: "#F59E0B", text: "#92400E", tag: "Atenção" },
  critico: { bg: "#FEF2F2", border: "#EF4444", text: "#991B1B", tag: "Importante" },
};

const ROXO = "#6D28D9";
const CINZA = "#475569";
const BORDA = "#D8DEE9";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Resolve o **negrito** inline do conteúdo (única marcação suportada). */
function rich(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

function block(b: ManualBlock): string {
  switch (b.kind) {
    case "p":
      return `<p class=txt>${rich(b.text)}</p>`;

    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const items = b.items.map((i) => `<li class=txt>${rich(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }

    case "steps": {
      const rows = b.items
        .map(
          (s, i) => `
            <tr>
              <td class=stepNum>${i + 1}</td>
              <td class=stepBody><p class=stepTitle>${rich(s.title)}</p><p class=txt>${rich(s.text)}</p></td>
            </tr>`,
        )
        .join("");
      return `<table class=steps cellspacing=0 cellpadding=0>${rows}</table>`;
    }

    case "table": {
      const head = b.headers.map((h) => `<td class=th>${rich(h)}</td>`).join("");
      const body = b.rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, i) => `<td class="td${i === 0 ? " tdFirst" : ""}">${rich(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `<table class=grid cellspacing=0 cellpadding=0><tr>${head}</tr>${body}</table>`;
    }

    case "callout": {
      const t = TONE[b.tone];
      return `
        <table class=callout cellspacing=0 cellpadding=0 style='background:${t.bg};border-left:4.5pt solid ${t.border}'>
          <tr><td class=calloutCell>
            <p class=calloutTitle style='color:${t.text}'>${esc(t.tag.toUpperCase())} · ${rich(b.title)}</p>
            <p class=txt>${rich(b.text)}</p>
          </td></tr>
        </table>`;
    }

    case "flow": {
      const rows = b.items
        .map(
          (s) => `
            <tr>
              <td class=flowActor>${rich(s.actor)}</td>
              <td class=flowBody>
                <p class=stepTitle>${rich(s.title)}</p>
                <p class=txt>${rich(s.text)}</p>
              </td>
              <td class=flowStatus>${rich(s.status)}</td>
            </tr>`,
        )
        .join("");
      return `<table class=grid cellspacing=0 cellpadding=0>
        <tr><td class=th>Quem</td><td class=th>Etapa</td><td class=th>Status resultante</td></tr>
        ${rows}
      </table>`;
    }

    case "statuses": {
      const rows = b.items
        .map((s) => {
          const t = TONE[s.tone];
          return `<tr>
            <td class=td><span class=badge style='background:${t.bg};color:${t.text}'>${rich(s.label)}</span></td>
            <td class=td>${rich(s.where)}</td>
            <td class=td>${rich(s.meaning)}</td>
          </tr>`;
        })
        .join("");
      return `<table class=grid cellspacing=0 cellpadding=0>
        <tr><td class=th>Status</td><td class=th>Onde aparece</td><td class=th>O que significa</td></tr>
        ${rows}
      </table>`;
    }

    case "faq":
      return b.items
        .map(
          (f) =>
            `<p class=faqQ>${rich(f.q)}</p><p class=faqA>${rich(f.a)}</p>`,
        )
        .join("");
  }
}

export function renderManualWordHtml(): string {
  const indice = MANUAL_SECTIONS.map(
    (s, i) =>
      `<p class=toc><b>${i + 1}. ${esc(s.title)}</b> — ${esc(s.summary)}</p>`,
  ).join("");

  const perfis = MANUAL_AUDIENCES.map(
    (a) => `<td class=td><b>${esc(a.label)}</b><br>${esc(a.description)}</td>`,
  ).join("");

  const secoes = MANUAL_SECTIONS.map((s, i) => {
    const publico =
      s.audiences.length === 0
        ? "Todos os perfis"
        : s.audiences
            .map((a) => MANUAL_AUDIENCES.find((x) => x.id === a)?.short ?? a)
            .join(" · ");
    return `
      <div class=secao>
        <h1 class=h1>${i + 1}. ${esc(s.title)}</h1>
        <p class=publico>Para: ${esc(publico)}</p>
        <p class=resumo>${esc(s.summary)}</p>
        ${s.blocks.map(block).join("\n")}
      </div>`;
  }).join("\n");

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${esc(MANUAL_TITLE)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: 21cm 29.7cm; margin: 2cm 2cm 2cm 2cm; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1E293B; }
.capa { border-top: 6pt solid ${ROXO}; padding-top: 14pt; margin-bottom: 22pt; }
.org { font-size: 9.5pt; color: ${ROXO}; letter-spacing: 1pt; text-transform: uppercase; margin: 0 0 4pt 0; }
.titulo { font-size: 30pt; font-weight: bold; color: #0F172A; margin: 0 0 2pt 0; line-height: 1.1; }
.sub { font-size: 13pt; color: ${CINZA}; margin: 0 0 12pt 0; }
.meta { font-size: 9.5pt; color: ${CINZA}; margin: 0; }
.h1 { font-size: 17pt; color: ${ROXO}; border-bottom: 1pt solid ${BORDA}; padding-bottom: 4pt; margin: 0 0 6pt 0; }
.h2 { font-size: 13pt; color: #0F172A; margin: 16pt 0 6pt 0; }
.publico { font-size: 9pt; color: ${ROXO}; font-weight: bold; margin: 0 0 2pt 0; text-transform: uppercase; letter-spacing: .5pt; }
.resumo { font-size: 10.5pt; color: ${CINZA}; font-style: italic; margin: 0 0 10pt 0; }
.txt { font-size: 11pt; line-height: 1.45; margin: 0 0 8pt 0; }
.toc { font-size: 10.5pt; margin: 0 0 5pt 0; color: #334155; }
.secao { page-break-before: always; }
table.grid { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt 0; }
.th { background: #F1F5F9; border: .75pt solid ${BORDA}; padding: 6pt 8pt; font-size: 9.5pt; font-weight: bold; color: #0F172A; text-transform: uppercase; letter-spacing: .4pt; }
.td { border: .75pt solid ${BORDA}; padding: 6pt 8pt; font-size: 10.5pt; vertical-align: top; }
.tdFirst { font-weight: bold; }
table.steps { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt 0; }
.stepNum { width: 26pt; background: ${ROXO}; color: #FFFFFF; font-weight: bold; font-size: 12pt; text-align: center; vertical-align: top; padding: 6pt 0; border: 2pt solid #FFFFFF; }
.stepBody { padding: 4pt 0 10pt 10pt; vertical-align: top; }
.stepTitle { font-size: 11pt; font-weight: bold; color: #0F172A; margin: 0 0 2pt 0; }
table.callout { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt 0; }
.calloutCell { padding: 8pt 10pt; }
.calloutTitle { font-size: 10pt; font-weight: bold; margin: 0 0 3pt 0; text-transform: uppercase; letter-spacing: .4pt; }
.flowActor { border: .75pt solid ${BORDA}; padding: 6pt 8pt; font-size: 9.5pt; font-weight: bold; color: ${ROXO}; width: 70pt; vertical-align: top; background: #FAFAFE; }
.flowBody { border: .75pt solid ${BORDA}; padding: 6pt 8pt; vertical-align: top; }
.flowStatus { border: .75pt solid ${BORDA}; padding: 6pt 8pt; font-size: 9.5pt; color: ${CINZA}; width: 95pt; vertical-align: top; }
.badge { padding: 1pt 6pt; font-size: 9.5pt; font-weight: bold; }
.faqQ { font-size: 11pt; font-weight: bold; color: #0F172A; margin: 10pt 0 2pt 0; }
.faqA { font-size: 10.5pt; line-height: 1.45; color: #334155; margin: 0 0 4pt 0; }
li { margin-bottom: 4pt; }
</style>
</head>
<body>
  <div class=capa>
    <p class=org>${esc(MANUAL_ORG)}</p>
    <p class=titulo>${esc(MANUAL_TITLE)}</p>
    <p class=sub>${esc(MANUAL_SUBTITLE)}</p>
    <p class=meta>Versão ${esc(MANUAL_VERSION)} · Atualizado em ${esc(MANUAL_UPDATED_AT)}</p>
  </div>

  <h1 class=h1 style='page-break-before:auto'>Como usar este manual</h1>
  <p class=txt>Este documento descreve o funcionamento do módulo <b>Compras</b> do Control Hub. As seções 1 a 3 valem para todo mundo; da seção 4 em diante o conteúdo é separado por perfil — leia a sua e consulte as outras quando precisar entender o que acontece antes ou depois de você.</p>
  <table class=grid cellspacing=0 cellpadding=0><tr>${perfis}</tr></table>

  <h2 class=h2>Conteúdo</h2>
  ${indice}

  ${secoes}
</body>
</html>`;
}
