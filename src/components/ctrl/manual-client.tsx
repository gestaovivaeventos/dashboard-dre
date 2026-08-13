"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  Search,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import {
  MANUAL_AUDIENCES,
  MANUAL_SECTIONS,
  MANUAL_SUBTITLE,
  MANUAL_TITLE,
  MANUAL_UPDATED_AT,
  MANUAL_VERSION,
  type ManualAudience,
  type ManualBlock,
  type ManualSection,
  type ManualTone,
} from "@/lib/ctrl/manual/content";

type Filtro = "todos" | ManualAudience;

const TONE_CLS: Record<ManualTone, { box: string; title: string; tag: string }> = {
  info: {
    box: "border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/30",
    title: "text-indigo-900 dark:text-indigo-200",
    tag: "Nota",
  },
  sucesso: {
    box: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30",
    title: "text-emerald-900 dark:text-emerald-200",
    tag: "OK",
  },
  atencao: {
    box: "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
    title: "text-amber-900 dark:text-amber-200",
    tag: "Atenção",
  },
  critico: {
    box: "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30",
    title: "text-red-900 dark:text-red-200",
    tag: "Importante",
  },
};

const BADGE_CLS: Record<ManualTone, string> = {
  info: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  sucesso: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  atencao: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  critico: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
};

/** Resolve o **negrito** inline do conteúdo (única marcação suportada). */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {p}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: ManualBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Rich text={block.text} />
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground ${
            block.ordered ? "list-decimal" : "list-disc"
          }`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              <Rich text={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case "steps":
      return (
        <ol className="space-y-2.5">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold">
                  <Rich text={s.title} />
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <Rich text={s.text} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                {block.headers.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {block.rows.map((row, i) => (
                <tr key={i} className="align-top">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2.5 leading-relaxed ${
                        j === 0 ? "font-medium" : "text-muted-foreground"
                      }`}
                    >
                      <Rich text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "callout": {
      const t = TONE_CLS[block.tone];
      return (
        <div className={`rounded-lg border-l-4 border-y border-r px-4 py-3 ${t.box}`}>
          <p className={`text-[11px] font-bold uppercase tracking-wide ${t.title}`}>
            {t.tag} · <Rich text={block.title} />
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            <Rich text={block.text} />
          </p>
        </div>
      );
    }

    case "flow":
      return (
        <div className="space-y-2">
          {block.items.map((s, i) => (
            <div key={i} className="relative">
              <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
                <div className="w-full shrink-0 sm:w-28">
                  <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                    {s.actor}
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold">
                    <Rich text={s.title} />
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <Rich text={s.text} />
                  </p>
                </div>
                <div className="shrink-0 sm:w-40 sm:text-right">
                  <span className="text-xs font-medium text-muted-foreground">
                    → {s.status}
                  </span>
                </div>
              </div>
              {i < block.items.length - 1 && (
                <div className="ml-6 h-2 w-px bg-border sm:ml-14" aria-hidden />
              )}
            </div>
          ))}
        </div>
      );

    case "statuses":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {block.items.map((s) => (
            <div key={s.label} className="space-y-1 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLS[s.tone]}`}
                >
                  {s.label}
                </span>
                <span className="text-[11px] text-muted-foreground">{s.where}</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Rich text={s.meaning} />
              </p>
            </div>
          ))}
        </div>
      );

    case "faq":
      return (
        <div className="divide-y rounded-lg border">
          {block.items.map((f, i) => (
            <details key={i} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-start gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                <span>{f.q}</span>
              </summary>
              <p className="mt-2 pl-6 text-sm leading-relaxed text-muted-foreground">
                <Rich text={f.a} />
              </p>
            </details>
          ))}
        </div>
      );
  }
}

/** Texto plano da seção — usado pela busca. */
function sectionText(s: ManualSection): string {
  const fromBlock = (b: ManualBlock): string => {
    switch (b.kind) {
      case "p":
        return b.text;
      case "list":
        return b.items.join(" ");
      case "steps":
        return b.items.map((i) => `${i.title} ${i.text}`).join(" ");
      case "table":
        return [...b.headers, ...b.rows.flat()].join(" ");
      case "callout":
        return `${b.title} ${b.text}`;
      case "flow":
        return b.items.map((i) => `${i.actor} ${i.title} ${i.status} ${i.text}`).join(" ");
      case "statuses":
        return b.items.map((i) => `${i.label} ${i.where} ${i.meaning}`).join(" ");
      case "faq":
        return b.items.map((i) => `${i.q} ${i.a}`).join(" ");
    }
  };
  return `${s.title} ${s.summary} ${s.blocks.map(fromBlock).join(" ")}`.toLowerCase();
}

// Faixa Unicode de marcas diacríticas combinantes (U+0300–U+036F), construída em
// runtime para manter o source ASCII (mesmo padrão de @/lib/ctrl/routing).
const COMBINING_DIACRITICS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

const normalize = (s: string) =>
  s.normalize("NFD").replace(COMBINING_DIACRITICS, "").toLowerCase();

export function ManualClient({ defaultAudience }: { defaultAudience: Filtro }) {
  const [filtro, setFiltro] = useState<Filtro>(defaultAudience);
  const [query, setQuery] = useState("");
  const [fechadas, setFechadas] = useState<Set<string>>(new Set());

  const buscando = query.trim().length >= 2;

  const secoes = useMemo(() => {
    const q = normalize(query.trim());
    return MANUAL_SECTIONS.filter((s) => {
      const doPerfil =
        filtro === "todos" || s.audiences.length === 0 || s.audiences.includes(filtro);
      if (!doPerfil) return false;
      if (!buscando) return true;
      return normalize(sectionText(s)).includes(q);
    });
  }, [filtro, query, buscando]);

  const aberta = (id: string) => buscando || !fechadas.has(id);

  const toggle = (id: string) =>
    setFechadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const todasAbertas = secoes.every((s) => !fechadas.has(s.id));

  const toggleTodas = () =>
    setFechadas(todasAbertas ? new Set(secoes.map((s) => s.id)) : new Set());

  const irPara = (id: string) => {
    setFechadas((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // Espera a seção abrir antes de rolar até ela.
    requestAnimationFrame(() => {
      document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="overflow-hidden rounded-xl border bg-gradient-to-br from-violet-50 to-transparent dark:from-violet-950/30">
        <div className="space-y-1 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-600 dark:text-violet-400">
            Control Hub · Compras
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{MANUAL_TITLE}</h1>
          <p className="text-sm text-muted-foreground">{MANUAL_SUBTITLE}</p>
          <p className="pt-1 text-xs text-muted-foreground">
            Versão {MANUAL_VERSION} · atualizado em {MANUAL_UPDATED_AT}
          </p>
        </div>
      </div>

      {/* Filtros por perfil + busca */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Ler como:</span>
          {(["todos", ...MANUAL_AUDIENCES.map((a) => a.id)] as Filtro[]).map((id) => {
            const label =
              id === "todos"
                ? "Manual completo"
                : MANUAL_AUDIENCES.find((a) => a.id === id)!.label;
            const ativo = filtro === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFiltro(id)}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  ativo
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar no manual (ex.: rateio, boleto, devolver)…"
              className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {!buscando && (
            <button
              type="button"
              onClick={toggleTodas}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              {todasAbertas ? (
                <>
                  <ChevronsDownUp className="h-4 w-4" /> Recolher tudo
                </>
              ) : (
                <>
                  <ChevronsUpDown className="h-4 w-4" /> Expandir tudo
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Índice */}
        <nav className="hidden lg:block">
          <div className="sticky top-4 space-y-1 rounded-lg border bg-card p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Conteúdo
            </p>
            {secoes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => irPara(s.id)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="mt-px w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
                  {i + 1}
                </span>
                <span className="min-w-0">{s.title}</span>
              </button>
            ))}
            {secoes.length === 0 && (
              <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                Nada encontrado.
              </p>
            )}
          </div>
        </nav>

        {/* Seções */}
        <div className="space-y-4">
          {filtro !== "todos" && !buscando && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <p>
                Você está lendo a versão do perfil{" "}
                <strong className="text-foreground">
                  {MANUAL_AUDIENCES.find((a) => a.id === filtro)?.label}
                </strong>
                . As seções gerais continuam visíveis. Para ver tudo, escolha{" "}
                <button
                  type="button"
                  onClick={() => setFiltro("todos")}
                  className="font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
                >
                  Manual completo
                </button>
                .
              </p>
            </div>
          )}

          {secoes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma seção encontrada para “{query}”.
              </p>
            </div>
          ) : (
            secoes.map((s, i) => {
              const publico =
                s.audiences.length === 0
                  ? "Todos os perfis"
                  : s.audiences
                      .map((a) => MANUAL_AUDIENCES.find((x) => x.id === a)?.short ?? a)
                      .join(" · ");
              const open = aberta(s.id);
              return (
                <section
                  key={s.id}
                  id={`sec-${s.id}`}
                  className="scroll-mt-4 overflow-hidden rounded-xl border bg-card"
                >
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-sm font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold">{s.title}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {publico}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {s.summary}
                      </span>
                    </span>
                    <ChevronDown
                      className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        open ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {open && (
                    <div className="space-y-4 border-t px-5 py-5">
                      {s.blocks.map((b, bi) => (
                        <Block key={bi} block={b} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <ArrowRight className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
            <span>
              Ficou alguma dúvida que o manual não responde? Fale com o administrador do
              Control Hub — a resposta vira conteúdo na próxima versão.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
