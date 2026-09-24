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

import { CicloPainel } from "@/components/orcamento/ciclo-painel";
import type { CicloInfo } from "@/lib/orcamento/actions/ciclo";
import { METODOS, metodoVisivelPara, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
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
    desc: "Entrevista com o gestor, item a item, nas categorias definidas por ele.",
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
 * Média, Valor fixo, Planejamento dos gestores) + a caixa de Configuração. É a
 * porta de entrada dos módulos daquela empresa. O andamento aparece como um selo
 * ÚNICO da empresa no topo (não por caixa) — Não iniciado / Em andamento /
 * Concluído.
 */
export function CompanyHub({
  companyId,
  year,
  status,
  isAdmin = false,
  ciclo = null,
}: {
  companyId: string;
  year: number;
  status?: OrcamentoStatusRaw;
  /*
   * Não há mais recorte de caixas por papel: com a validação acontecendo DENTRO
   * das telas de método, todo mundo usa as mesmas portas. O que muda por papel
   * é o que cada tela oferece lá dentro (a barra de validação, o visto, as
   * ações da diretoria) — não a lista de caixas.
   */
  /**
   * Estado do ciclo. Quando presente, o painel do ciclo substitui o selo
   * heurístico de `status.ts` (que adivinhava o andamento contando linhas
   * preenchidas) — o estado passou a ser fato registrado, não estimativa.
   */
  ciclo?: CicloInfo | null;
  /**
   * Mostra a caixa "Configuração". As telas de config redefinem as PREMISSAS
   * do orçamento (método por categoria, plano de cargos, encargos) e seguem
   * admin-only — a rota é negada em access.ts e no layout de `config/`; aqui é
   * só não oferecer um caminho que terminaria em redirect.
   */
  isAdmin?: boolean;
}) {
  // Só os 4 métodos de despesa (VE ficam de fora do hub padrão), menos os que
  // ainda estão em validação e só o admin enxerga (METODOS_EM_VALIDACAO).
  const metodos = METODOS.filter((m) => !m.ve && metodoVisivelPara(m.key, Boolean(isAdmin)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Módulos do orçamento</h2>
          <p className="text-sm text-muted-foreground">
            Escolha por onde começar. Cada módulo guarda seus próprios valores.
          </p>
        </div>
        {/* Selo heurístico só como reserva: se o ciclo existe, ele é a fonte. */}
        {!ciclo && status && <StatusBadge selo={statusGeral(status)} className="mt-0.5" />}
      </div>

      {/* Painel do ciclo: ADMIN-ONLY. As transições (enviar, devolver, voltar
          para edição, concluir) são atos da empresa inteira e só o administrador
          as dispara — para o gestor e para o diretor o painel seria informação
          que eles não acionam. Quem valida vê o estado na barra da própria tela
          de método; quem constrói, na faixa do workspace. */}
      {ciclo && isAdmin && <CicloPainel companyId={companyId} year={year} ciclo={ciclo} />}

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

        {/* A caixa "Retorno da diretoria" saiu daqui com a VALIDAÇÃO, em
            24/09/2026 — ela será redesenhada. O ciclo (construção → validação →
            retorno) e a trilha de alterações continuam de pé; o que não existe
            mais é a tela que lia as decisões. */}

        {/* Configuração da empresa — sub-hub com as seções de config por
            empresa. Admin-only (ver isAdmin acima). */}
        {isAdmin && (
          <Tile
            icon={SlidersHorizontal}
            title="Configuração"
            desc="Método por categoria, setores, plano de cargos e encargos."
            href={workspaceConfigHref(companyId, year)}
          />
        )}
      </div>
    </div>
  );
}
