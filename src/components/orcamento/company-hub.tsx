import Link from "next/link";
import {
  ArrowRight,
  Clock,
  Coins,
  Handshake,
  LineChart,
  Plane,
  SlidersHorizontal,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

import { METODOS, metodoVisivelPara, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import {
  isWorkspaceTabBuilt,
  workspaceTabHref,
  workspaceConfigHref,
  workspacePreviaHref,
} from "@/lib/orcamento/workspace-tabs";
import { statusGeral, type OrcamentoStatusRaw } from "@/lib/orcamento/status";
import type { ContagemPorMetodo } from "@/lib/orcamento/actions/validacao-diretoria";
import type { ContagemValidacao } from "@/lib/orcamento/validacao-diretoria";
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
  viagens: {
    icon: Plane,
    desc: "Roteiros de viagem, com o custo calculado pelo sistema a partir do trajeto.",
  },
  // VE não aparecem no hub padrão (telas construídas depois).
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
  /** Rodapé do card: o andamento da validação neste método. */
  rodape?: React.ReactNode;
}

function Tile({ icon: Icon, title, desc, href, comingSoon, rodape }: TileProps) {
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
      {rodape}
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
  validacoes = {},
  podeValidar = false,
}: {
  companyId: string;
  year: number;
  status?: OrcamentoStatusRaw;
  /** Andamento da validação por método, já recortado no setor de quem vê. */
  validacoes?: ContagemPorMetodo;
  /** Quem vê é quem decide? Muda o texto do rodapé, não o número. */
  podeValidar?: boolean;
  /*
   * Não há mais recorte de caixas por papel: com a validação acontecendo DENTRO
   * das telas de método, todo mundo usa as mesmas portas. O que muda por papel
   * é o que cada tela oferece lá dentro (a barra de validação, o visto, as
   * ações da diretoria) — não a lista de caixas.
   */
  /**
   * Mostra a caixa "Configuração". As telas de config redefinem as PREMISSAS
   * do orçamento (método por categoria, plano de cargos, encargos) e seguem
   * admin-only — a rota é negada em access.ts e no layout de `config/`; aqui é
   * só não oferecer um caminho que terminaria em redirect.
   */
  isAdmin?: boolean;
}) {
  // Só os métodos com tela (os de VE ficam de fora do hub), menos os que ainda
  // estão em validação e só o admin enxerga (METODOS_EM_VALIDACAO). Quem decide
  // se a caixa linka ou fica "em breve" é `isWorkspaceTabBuilt`.
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
        {/* Selo heurístico (conta linhas preenchidas). Era reserva enquanto o
            ciclo existia; com o ciclo fora, voltou a ser a única leitura de
            andamento. */}
        {status && <StatusBadge selo={statusGeral(status)} className="mt-0.5" />}
      </div>

      {/* Aqui ficava o PAINEL DO CICLO (admin-only): estado, entregas dos
          setores e as transições construção → validação → retorno. Saiu em
          24/09/2026 junto com a validação — os dois serão redesenhados. */}

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
              rodape={
                built ? (
                  <RodapeValidacao contagem={validacoes[m.key]} podeValidar={podeValidar} />
                ) : undefined
              }
            />
          );
        })}

        {/* A caixa "Retorno da diretoria" saiu daqui com a VALIDAÇÃO e o
            CICLO, em 24/09/2026 — tudo será redesenhado. Só a trilha de
            alterações continua de pé. */}

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

/**
 * O andamento da validação no rodapé do card.
 *
 * Duas leituras da MESMA contagem, e isso é de propósito: o diretor precisa
 * saber quantas verificações tem pela frente naquele método, e o gestor
 * quantas voltaram para ele, quantas passaram e quantas caíram. A contagem já
 * vem recortada no setor de quem pergunta, então cada gerente lê o número do
 * próprio setor sem a tela saber disso.
 */
function RodapeValidacao({
  contagem,
  podeValidar,
}: {
  contagem?: ContagemValidacao;
  podeValidar: boolean;
}) {
  // Método sem nada orçado não ganha rodapé: "0 a verificar" num card vazio
  // é ruído, não informação.
  if (!contagem || contagem.total === 0) return null;

  const partes: { texto: string; classe: string }[] = [];
  if (podeValidar) {
    if (contagem.pendentes > 0) {
      partes.push({
        texto: `${contagem.pendentes} a verificar`,
        classe: "text-amber-700 dark:text-amber-500",
      });
    }
  } else if (contagem.revisar > 0) {
    partes.push({
      texto: `${contagem.revisar} com pergunta`,
      classe: "text-sky-700 dark:text-sky-400",
    });
  }
  if (contagem.aprovados > 0) {
    partes.push({
      texto: `${contagem.aprovados} aprovada(s)`,
      classe: "text-emerald-600 dark:text-emerald-400",
    });
  }
  if (contagem.reprovados > 0) {
    partes.push({ texto: `${contagem.reprovados} reprovada(s)`, classe: "text-destructive" });
  }
  // Para o diretor, o 'revisar' entra depois das outras: é fila do gestor, não
  // dele — mas ele precisa ver que devolveu.
  if (podeValidar && contagem.revisar > 0) {
    partes.push({
      texto: `${contagem.revisar} devolvida(s)`,
      classe: "text-sky-700 dark:text-sky-400",
    });
  }
  if (partes.length === 0) return null;

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t pt-2 text-[11px] font-medium">
      {partes.map((p) => (
        <span key={p.texto} className={p.classe}>
          {p.texto}
        </span>
      ))}
    </p>
  );
}
