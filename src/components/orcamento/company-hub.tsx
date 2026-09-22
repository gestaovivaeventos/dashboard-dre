import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  Clock,
  History,
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
import { METODOS, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import type { OrcamentoPapel } from "@/lib/supabase/types";
import {
  isWorkspaceTabBuilt,
  workspaceTabHref,
  workspaceConfigHref,
  workspacePreviaHref,
  workspaceRetornoHref,
  workspaceValidacaoHref,
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
  papel = null,
}: {
  companyId: string;
  year: number;
  status?: OrcamentoStatusRaw;
  /**
   * Papel de quem está olhando. O hub mostra o que ESTE papel faz: o gestor não
   * precisa da tela de validação, o diretor não precisa de 8 portas para achar
   * a dele. (Admin continua vendo tudo — é quem opera o ciclo.)
   *
   * Todos veem as telas de método: a diretoria também monta o orçamento do
   * setor dela (o Diretoria), como qualquer gestor.
   */
  papel?: OrcamentoPapel | null;
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
  // Só os 4 métodos de despesa (VE ficam de fora do hub padrão).
  const metodos = METODOS.filter((m) => !m.ve);

  const ehDiretoria = papel === "validador";
  const emValidacao = ciclo?.estado === "em_validacao";
  // A validação é do diretor (e do admin). Para o gestor a caixa só abriria uma
  // tela que ele não opera — é ruído.
  const mostraValidacao =
    Boolean(ciclo) && ciclo!.estado !== "em_construcao" && (ehDiretoria || isAdmin);
  // O retorno é de quem montou. O diretor também vê: é onde ele confere o que
  // decidiu e responde aos pedidos de liberação.
  const mostraRetorno =
    Boolean(ciclo) &&
    ["em_ajuste", "concluido", "publicado"].includes(ciclo!.estado);

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

      {ciclo && <CicloPainel companyId={companyId} year={year} ciclo={ciclo} />}

      {/* Quando é a vez da diretoria, a validação vira a chamada principal —
          em vez de mais uma caixa no meio de oito. Não há redirecionamento
          automático de propósito: o diretor também monta o setor dele, e cair
          numa tela que ele não escolheu esconderia o resto. */}
      {mostraValidacao && emValidacao && (
        <Link
          href={workspaceValidacaoHref(companyId, year)}
          className="group flex items-center gap-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 transition-colors hover:border-amber-500/70 hover:bg-amber-500/10"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <ClipboardCheck className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Validar o orçamento</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Percorra por setor e categoria, decida item a item e conclua a validação.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

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

        {/* Validação da diretoria. Só aparece depois de o orçamento sair para
            validação: antes disso não há o que validar, e uma caixa que abre
            uma tela vazia é ruído. Continua visível nas fases seguintes porque
            é por ela que se confere o que foi decidido. */}
        {mostraValidacao && !emValidacao && (
          <Tile
            icon={ClipboardCheck}
            title="Validação da diretoria"
            desc="O que a diretoria cancelou, alterou ou pediu para ajustar."
            href={workspaceValidacaoHref(companyId, year)}
          />
        )}

        {/* Retorno da diretoria. Aparece a partir do momento em que existe
            decisão para ler — antes disso a lista estaria vazia. Fica visível
            nas fases seguintes porque é também o histórico do orçamento. */}
        {mostraRetorno && (
            <Tile
              icon={History}
              title="Retorno da diretoria"
              desc="O que mudou, por quê, e o que ainda depende de você."
              href={workspaceRetornoHref(companyId, year)}
            />
          )}

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
