import Link from "next/link";
import {
  ArrowRight,
  Clock,
  Coins,
  Handshake,
  LineChart,
  SlidersHorizontal,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

import { METODOS, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import {
  isWorkspaceTabBuilt,
  workspaceTabHref,
  workspaceConfigHref,
  workspacePreviaHref,
} from "@/lib/orcamento/workspace-tabs";
import { statusGeral, type OrcamentoStatusRaw } from "@/lib/orcamento/status";
import { StatusBadge } from "@/components/orcamento/status-badge";

// Ícone + descrição por método (os rótulos vêm de METODOS, fonte única).
const METODO_UI: Record<OrcamentoMetodo, { icon: LucideIcon; desc: string }> = {
  pessoal: { icon: Users, desc: "Quadro de colaboradores, encargos e benefícios." },
  media: { icon: TrendingUp, desc: "Média do realizado do ano anterior, corrigida por índice." },
  valor_fixo: { icon: Coins, desc: "Valores fixos por categoria, corrigidos por índice." },
  planejamento_socios: {
    icon: Handshake,
    desc: "Definições dos sócios (pró-labore, dividendos, aportes).",
  },
  // VE não aparecem no hub padrão (telas construídas depois).
  viagens_ve: { icon: Coins, desc: "" },
  marketing_ve: { icon: Coins, desc: "" },
  endomarketing_ve: { icon: Coins, desc: "" },
};

interface TileProps {
  icon: LucideIcon;
  title: string;
  desc: string;
  href?: string;
  /** Marca o módulo ainda não construído. */
  comingSoon?: boolean;
}

function Tile({ icon: Icon, title, desc, href, comingSoon }: TileProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        {comingSoon ? (
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3 w-3" />
            Em breve
          </span>
        ) : (
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        )}
      </div>
      <div className="mt-3">
        <div className="font-semibold">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
    </>
  );

  if (!href) {
    return (
      <div
        aria-disabled
        className="flex min-h-[8.5rem] flex-col rounded-xl border border-dashed bg-card/50 p-5 opacity-70"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group flex min-h-[8.5rem] flex-col rounded-xl border bg-card p-5 transition-colors hover:border-emerald-500/40 hover:bg-muted/40"
    >
      {inner}
    </Link>
  );
}

/**
 * Hub de "caixas" da empresa: uma caixa por MÉTODO de orçamento (Pessoal,
 * Média, Valor fixo, Planejamento dos sócios) + a caixa de Configuração. É a
 * porta de entrada dos módulos daquela empresa. O andamento aparece como um selo
 * ÚNICO da empresa no topo (não por caixa) — Não iniciado / Em andamento /
 * Concluído.
 */
export function CompanyHub({
  companyId,
  year,
  status,
}: {
  companyId: string;
  year: number;
  status?: OrcamentoStatusRaw;
}) {
  // Só os 4 métodos de despesa (VE ficam de fora do hub padrão).
  const metodos = METODOS.filter((m) => !m.ve);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Módulos do orçamento</h2>
          <p className="text-sm text-muted-foreground">
            Escolha por onde começar. Cada módulo guarda seus próprios valores.
          </p>
        </div>
        {status && <StatusBadge selo={statusGeral(status)} className="mt-0.5" />}
      </div>

      {/* Prévia do orçamento — o resultado consolidado dos métodos, em destaque
          acima das caixas de entrada. */}
      <Link
        href={workspacePreviaHref(companyId, year)}
        className="group flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-600/5 p-5 transition-colors hover:border-emerald-500/60 hover:bg-emerald-600/10"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
          <LineChart className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Prévia do orçamento</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A DRE da empresa com tudo que você orçou — atualiza sozinha conforme os métodos são
            preenchidos.
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metodos.map((m) => {
          const built = isWorkspaceTabBuilt(m.key);
          const ui = METODO_UI[m.key];
          return (
            <Tile
              key={m.key}
              icon={ui.icon}
              title={m.label}
              desc={ui.desc}
              href={built ? workspaceTabHref(companyId, year, m.key) : undefined}
              comingSoon={!built}
            />
          );
        })}

        {/* Configuração da empresa — sub-hub com as seções de config por empresa. */}
        <Tile
          icon={SlidersHorizontal}
          title="Configuração"
          desc="Método por categoria, setores, plano de cargos e encargos."
          href={workspaceConfigHref(companyId, year)}
        />
      </div>
    </div>
  );
}
