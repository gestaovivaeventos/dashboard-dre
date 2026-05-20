"use client";

import {
  BarChart3,
  Bell,
  Brain,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cog,
  Command,
  DollarSign,
  FileText,
  LayoutDashboard,
  MapPinned,
  PieChart,
  Plug,
  Receipt,
  Search,
  ShoppingCart,
  Target,
  Truck,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type LucideIcon = typeof PieChart;

interface Item {
  key: string;
  title: string;
  icon: LucideIcon;
  group: "fin" | "ct" | "pf";
}

const ITEMS: Item[] = [
  { key: "fin-dashboard", title: "Dashboard", icon: PieChart, group: "fin" },
  { key: "fin-fluxo", title: "Fluxo de Caixa", icon: Wallet, group: "fin" },
  { key: "fin-budget", title: "Budget e Forecast", icon: Target, group: "fin" },
  { key: "fin-kpis", title: "KPIs", icon: BarChart3, group: "fin" },
  { key: "fin-map", title: "Mapeamento", icon: MapPinned, group: "fin" },
  { key: "fin-config", title: "Configuracoes", icon: Cog, group: "fin" },
  { key: "ct-req", title: "Requisicoes", icon: FileText, group: "ct" },
  { key: "ct-apr", title: "Aprovacoes", icon: CheckSquare, group: "ct" },
  { key: "ct-cap", title: "Contas a Pagar", icon: Receipt, group: "ct" },
  { key: "ct-orc", title: "Orcamento", icon: DollarSign, group: "ct" },
  { key: "ct-rel", title: "Relatorios Compras", icon: BarChart3, group: "ct" },
  { key: "ct-forn", title: "Fornecedores", icon: Truck, group: "ct" },
  { key: "ct-evt", title: "Eventos", icon: Calendar, group: "ct" },
  { key: "pf-conex", title: "Conexoes", icon: Plug, group: "pf" },
  { key: "pf-users", title: "Usuarios", icon: Users, group: "pf" },
  { key: "pf-intel", title: "Inteligencia", icon: Brain, group: "pf" },
  { key: "pf-painel", title: "Painel Admin", icon: LayoutDashboard, group: "pf" },
];

const GROUPS = {
  fin: { label: "Financeiro", icon: PieChart, accent: "from-emerald-500 to-emerald-700" },
  ct: { label: "Compras", icon: ShoppingCart, accent: "from-orange-500 to-orange-700" },
  pf: { label: "Plataforma", icon: Wrench, accent: "from-violet-500 to-violet-700" },
} as const;

const SEGMENTS = [
  "Viva Franquias",
  "Viva Eventos",
  "GSalao",
  "Holding Viva",
  "Conselho Viva",
];

export default function MenuLabPage() {
  const [variant, setVariant] = useState<"A" | "B" | "C">("A");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Lab top bar */}
      <div className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="rounded bg-viva-500 px-2 py-0.5 text-xs font-bold">LAB</span>
          <h1 className="text-sm font-semibold">Menu Lab — 3 variantes</h1>
        </div>
        <div className="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-1">
          {(["A", "B", "C"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariant(v)}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                variant === v
                  ? "bg-viva-500 text-white"
                  : "text-zinc-300 hover:text-white"
              }`}
            >
              Variante {v}
            </button>
          ))}
        </div>
        <a href="/home" className="text-xs text-zinc-400 hover:text-white">
          ← voltar pro app
        </a>
      </div>

      {/* Description panel */}
      <DescriptionPanel variant={variant} />

      {/* Variant preview */}
      <div className="mx-auto max-w-[1400px] p-6">
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          {variant === "A" && <VariantA />}
          {variant === "B" && <VariantB />}
          {variant === "C" && <VariantC />}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Descrição rápida no topo                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

function DescriptionPanel({ variant }: { variant: "A" | "B" | "C" }) {
  const meta = {
    A: {
      name: "Sidebar com busca + grupos colapsáveis",
      bullets: [
        "Search inline no topo da sidebar filtra itens em tempo real (digita 'fluxo' → só sobra 1 item).",
        "Grupos (Financeiro, Compras, Plataforma) podem colapsar/expandar com chevron — estado persiste.",
        "Cmd+K abre overlay de busca global com todos os itens + atalhos.",
        "Segmento ativo é um chip discreto no topo, clica pra trocar.",
        "Bom pra: quem tem muitos itens e usa um subset diferente em cada sessão.",
      ],
    },
    B: {
      name: "Top dropdowns + sem sidebar",
      bullets: [
        "Header com 3 botões grandes: FINANCEIRO ▾ / COMPRAS ▾ / PLATAFORMA ▾",
        "Click abre painel wide (mega-menu) com todos os itens daquele domínio em grid.",
        "Sem sidebar — tela inteira pra trabalhar. Volta uma vez que escolheu a página.",
        "Segmento ao lado dos dropdowns, sempre visível.",
        "Bom pra: dashboards e telas largas; familiar pra quem vem de SAP/Salesforce.",
      ],
    },
    C: {
      name: "Rail mínimo + Command palette",
      bullets: [
        "Rail vertical de 56px só com 3 ícones (um por domínio) + segmento.",
        "Hover/click no ícone expande um drawer temporário com os itens.",
        "Cmd+K em destaque — atalho principal de navegação (Linear/Vercel style).",
        "Maximiza área útil da tela; navegação por teclado em primeiro lugar.",
        "Bom pra: power users; quem decora atalhos e quer máximo espaço.",
      ],
    },
  }[variant];

  return (
    <div className="mx-auto max-w-[1400px] px-6 pt-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-base font-semibold text-white">Variante {variant} — {meta.name}</h2>
        <ul className="space-y-1 text-sm text-zinc-300">
          {meta.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-zinc-500">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Variante A — Sidebar com busca + grupos colapsáveis + Cmd+K              */
/* ──────────────────────────────────────────────────────────────────────── */

function VariantA() {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState("fin-dashboard");
  const [seg, setSeg] = useState(SEGMENTS[0]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [segOpen, setSegOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? ITEMS.filter((i) => i.title.toLowerCase().includes(q))
    : ITEMS;

  const grouped = (["fin", "ct", "pf"] as const).map((gid) => ({
    gid,
    items: filtered.filter((i) => i.group === gid),
  }));

  return (
    <div className="flex h-[640px] bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-72 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="text-base font-bold text-viva-500">Viva DRE</div>
        </div>

        {/* Segment chip */}
        <div className="relative border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setSegOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="truncate">{seg}</span>
            </span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </button>
          {segOpen && (
            <div className="absolute left-3 right-3 top-full z-10 mt-1 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSeg(s);
                    setSegOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    s === seg ? "font-semibold text-viva-500" : ""
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pagina..."
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-viva-500 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400">
            <span>{filtered.length} item{filtered.length !== 1 && "s"}</span>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800"
            >
              <Command className="h-3 w-3" /> K
            </button>
          </div>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {grouped.map(({ gid, items }) => {
            if (items.length === 0) return null;
            const isCollapsed = collapsed[gid];
            const G = GROUPS[gid];
            return (
              <div key={gid} className="mb-2">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [gid]: !c[gid] }))
                  }
                  className="flex w-full items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {G.label}
                  <span className="ml-auto text-zinc-400">{items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="mt-0.5 space-y-0.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const active = activeKey === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setActiveKey(item.key)}
                          className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                            active
                              ? "bg-viva-500 text-white"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-zinc-500">Nada encontrado.</p>
          )}
        </div>
      </aside>

      {/* Stage */}
      <main className="flex-1 p-8">
        <Stage activeKey={activeKey} segment={seg} />
      </main>

      {/* Command palette */}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onPick={(k) => {
            setActiveKey(k);
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Variante B — Top mega-menu, sem sidebar                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function VariantB() {
  const [openMenu, setOpenMenu] = useState<"fin" | "ct" | "pf" | null>(null);
  const [activeKey, setActiveKey] = useState("fin-dashboard");
  const [seg, setSeg] = useState(SEGMENTS[0]);
  const [segOpen, setSegOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setSegOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="flex h-[640px] flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Topbar */}
      <header className="relative flex h-14 items-center gap-2 border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mr-4 text-base font-bold text-viva-500">Viva DRE</div>

        {(["fin", "ct", "pf"] as const).map((gid) => {
          const G = GROUPS[gid];
          const Icon = G.icon;
          const isOpen = openMenu === gid;
          return (
            <button
              key={gid}
              type="button"
              onClick={() => setOpenMenu(isOpen ? null : gid)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isOpen
                  ? "bg-viva-500 text-white"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {G.label}
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSegOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {seg}
              <ChevronDown className="h-4 w-4 opacity-60" />
            </button>
            {segOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {SEGMENTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSeg(s);
                      setSegOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      s === seg ? "font-semibold text-viva-500" : ""
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Bell className="h-5 w-5 text-zinc-500" />
        </div>

        {/* Mega menu panel */}
        {openMenu && (
          <div className="absolute left-0 right-0 top-full z-30 border-b border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mx-auto max-w-[1100px]">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                {GROUPS[openMenu].label}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ITEMS.filter((i) => i.group === openMenu).map((item) => {
                  const Icon = item.icon;
                  const active = activeKey === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setActiveKey(item.key);
                        setOpenMenu(null);
                      }}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                        active
                          ? "border-viva-500 bg-viva-500/10"
                          : "border-zinc-200 hover:border-viva-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <div className={`rounded-md bg-gradient-to-br ${GROUPS[openMenu].accent} p-2 text-white`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{item.title}</div>
                        <div className="truncate text-xs text-zinc-500">{GROUPS[openMenu].label}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Stage */}
      <main className="flex-1 p-8">
        <Stage activeKey={activeKey} segment={seg} />
      </main>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Variante C — Rail mínimo + Command palette                               */
/* ──────────────────────────────────────────────────────────────────────── */

function VariantC() {
  const [hoverGroup, setHoverGroup] = useState<"fin" | "ct" | "pf" | null>(null);
  const [pinnedGroup, setPinnedGroup] = useState<"fin" | "ct" | "pf" | null>(null);
  const [activeKey, setActiveKey] = useState("fin-dashboard");
  const [seg] = useState(SEGMENTS[0]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const drawerGroup = pinnedGroup ?? hoverGroup;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-[640px] bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Rail */}
      <aside className="flex w-14 flex-col items-center gap-1 border-r border-zinc-200 bg-white py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 grid h-9 w-9 place-items-center rounded-md bg-viva-500 text-sm font-bold text-white">
          V
        </div>
        <div className="my-1 h-px w-7 bg-zinc-200 dark:bg-zinc-800" />
        {(["fin", "ct", "pf"] as const).map((gid) => {
          const G = GROUPS[gid];
          const Icon = G.icon;
          const isActive = drawerGroup === gid;
          return (
            <button
              key={gid}
              type="button"
              onMouseEnter={() => setHoverGroup(gid)}
              onMouseLeave={() => setHoverGroup(null)}
              onClick={() => setPinnedGroup(pinnedGroup === gid ? null : gid)}
              className={`grid h-10 w-10 place-items-center rounded-md transition-colors ${
                isActive
                  ? "bg-viva-500 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
              }`}
              title={G.label}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            title="Cmd+K"
          >
            <Command className="h-5 w-5" />
          </button>
        </div>
      </aside>

      {/* Drawer overlay (hovered or pinned) */}
      {drawerGroup && (
        <aside
          onMouseEnter={() => setHoverGroup(drawerGroup)}
          onMouseLeave={() => setHoverGroup(null)}
          className="w-64 border-r border-zinc-200 bg-white py-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between px-4 pb-2">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              {GROUPS[drawerGroup].label}
            </div>
            {pinnedGroup === drawerGroup && (
              <button
                type="button"
                onClick={() => setPinnedGroup(null)}
                className="text-zinc-400 hover:text-zinc-700"
                title="Desafixar"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="space-y-0.5 px-2">
            {ITEMS.filter((i) => i.group === drawerGroup).map((item) => {
              const Icon = item.icon;
              const active = activeKey === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveKey(item.key)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-viva-500 text-white"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.title}</span>
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {/* Stage */}
      <main className="flex-1 p-8">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-600 shadow-sm hover:border-viva-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <Search className="h-4 w-4" />
            <span>Buscar ou ir para…</span>
            <kbd className="ml-3 flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
              <Command className="h-3 w-3" /> K
            </kbd>
          </button>
          <div className="ml-auto flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {seg}
          </div>
        </div>
        <Stage activeKey={activeKey} segment={seg} />
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onPick={(k) => {
            setActiveKey(k);
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Stage compartilhada (área de conteúdo simulada)                          */
/* ──────────────────────────────────────────────────────────────────────── */

function Stage({ activeKey, segment }: { activeKey: string; segment: string }) {
  const item = ITEMS.find((i) => i.key === activeKey);
  if (!item) return null;
  const Icon = item.icon;
  const G = GROUPS[item.group];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
        {G.label} · {segment}
      </div>
      <div className="flex items-center gap-3">
        <div className={`rounded-lg bg-gradient-to-br ${G.accent} p-3 text-white shadow-lg`}>
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-bold">{item.title}</h2>
      </div>
      <p className="mt-4 text-sm text-zinc-500">
        Conteúdo da página apareceria aqui. Esta é uma mock só pra dimensionar o menu.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-3">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-24 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700"
          />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Command palette (Cmd+K) — compartilhado por A e C                        */
/* ──────────────────────────────────────────────────────────────────────── */

function CommandPalette({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return qq ? ITEMS.filter((i) => i.title.toLowerCase().includes(qq)) : ITEMS;
  }, [q]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[idx]) {
        onPick(filtered[idx].key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, idx, onClose, onPick]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-32 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[560px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <Search className="h-5 w-5 text-zinc-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ir para qualquer pagina…"
            className="flex-1 bg-transparent text-base text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">
              Nada encontrado.
            </div>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              const G = GROUPS[item.group];
              const active = i === idx;
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => onPick(item.key)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                    active ? "bg-viva-500/20" : ""
                  }`}
                >
                  <Icon className="h-4 w-4 text-zinc-400" />
                  <span className="flex-1 text-sm text-zinc-100">
                    {item.title}
                  </span>
                  <span className="text-xs text-zinc-500">{G.label}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
          <span>↑↓ navegar · ⏎ abrir · ESC fechar</span>
          <span>{filtered.length} resultado{filtered.length !== 1 && "s"}</span>
        </div>
      </div>
    </div>
  );
}
