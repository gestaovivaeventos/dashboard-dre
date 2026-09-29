"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MessageSquare, RotateCcw, Trash2, UserPlus, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { decidirItem } from "@/lib/orcamento/actions/validacao-diretoria";
import { ESTADO_LABEL } from "@/lib/orcamento/validacao-diretoria";
import type { DecisaoAplicada } from "@/lib/orcamento/previa-setor-decisao";

import {
  createColaborador,
  deleteColaborador,
  reativarColaborador,
  getColaboradores,
  getPessoalSetup,
  setBeneficioAgrupar,
  setRegimeApuracao,
  updateColaborador,
  updateColaboradorBeneficios,
  type CargoOption,
  type Colaborador,
  type ColaboradorInput,
  type EmpresaEncargosOption,
  type Movimentacao,
  type PessoalSetup,
} from "@/lib/orcamento/actions/pessoal";
import {
  REGIMES_APURACAO,
  REGIME_APURACAO_PADRAO,
  type RegimeApuracao,
} from "@/lib/orcamento/regime-apuracao";
import { BENEFICIOS, type BeneficioKey, type Beneficios } from "@/lib/orcamento/beneficios";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import {
  SETOR_TODOS,
  agruparPorSetor,
  isTodosSetores,
  setorEspecifico,
} from "@/lib/orcamento/setor-filtro";
import {
  MOV_TIPOS,
  VINCULOS,
  movTemCargo,
  vinculoLabel,
  type MovTipo,
  type VinculoKey,
} from "@/lib/orcamento/vinculos";
import { PreviaPessoal } from "@/components/orcamento/previa-pessoal";
import { ValidacaoSetorPainel } from "@/components/orcamento/validacao-setor-painel";
import { ColaboradorDetalhe } from "@/components/orcamento/colaborador-detalhe";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const CELL =
  "w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-40 disabled:bg-muted/40";

function readSalario(input: string): number | null {
  const v = parseBrNumber(input);
  if (v == null || Number.isNaN(v)) return null;
  return v;
}
// Meses (o ano é sempre o ano do orçamento, então fica subentendido).
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_OPTIONS = MESES.map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label }));

/** "MM" + ano do orçamento → "YYYY-MM-01" para gravar. */
function mesToIso(mes: string, year: number): string | null {
  return mes ? `${year}-${mes}-01` : null;
}
/** "YYYY-MM-01" → "MM" para o seletor de mês. */
function isoToMes(iso: string | null): string {
  return iso ? iso.slice(5, 7) : "";
}
function buildMov(
  tipo: "" | MovTipo,
  mes: string,
  cargo: string,
  salario: string,
  year: number,
): Movimentacao | null {
  if (!tipo) return null;
  if (!movTemCargo(tipo)) {
    return { tipo, data: mesToIso(mes, year), cargo: null, salario: null };
  }
  return {
    tipo,
    data: mesToIso(mes, year),
    cargo: cargo.trim() || null,
    salario: readSalario(salario),
  };
}

/** Célula de salário: mostra "R$ 3.000,00" quando não está em foco; ao focar,
 * exibe o valor cru para edição; ao sair, reformata. */
function CurrencyCell({
  value,
  onChange,
  onBlur,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const num = parseBrNumber(value);
  const display = focused || num == null || Number.isNaN(num) ? value : formatBRL(num);
  return (
    <input
      value={display}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      inputMode="decimal"
      placeholder="R$ 0,00"
      disabled={disabled}
      className={className}
    />
  );
}

type TabKey = "quadro" | "beneficios" | "colaborador" | "previa";

// A aba "Validação" saiu em 29/09/2026: a decisão da diretoria foi para a
// PRÓPRIA LINHA de cada colaborador (mesmo gesto do Planejamento dos gestores)
// e a prévia do setor desceu para baixo do quadro. Decidir num lugar e ver o
// efeito noutro obrigava a trocar de aba a cada ✓.
const TABS: readonly { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: "quadro", label: "Quadro" },
  // Benefícios é PREMISSA, como o regime de apuração e o check "Agrupar" (que
  // já era admin-only dentro dela): o gestor monta o quadro, não define quanto
  // vale o vale-transporte da empresa.
  { key: "beneficios", label: "Benefícios", adminOnly: true },
  { key: "colaborador", label: "Colaborador" },
  { key: "previa", label: "Prévia" },
] as const;

const EMPTY_SETUP: PessoalSetup = {
  orcarPorSetor: false,
  regimeApuracao: REGIME_APURACAO_PADRAO,
  setores: [],
  cargoOptions: [],
  beneficiosSeparados: [],
  empresas: [],
  usarEmpresaEncargos: false,
};

export function DespesasPessoalManager({
  companyId,
  year,
  isAdmin = false,
  podeValidar = false,
}: {
  companyId: string;
  year: number;
  /** Quem vê decide? Mostra ✓ / ✗ / comentário na linha de cada colaborador. */
  podeValidar?: boolean;
  /** Admin desfaz cancelamento da diretoria; o gestor só vê. */
  isAdmin?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("quadro");
  const [setorId, setSetorId] = useState<string | null>(null);
  const [setup, setSetup] = useState<PessoalSetup>(EMPTY_SETUP);
  const [items, setItems] = useState<Colaborador[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [savingRegime, setSavingRegime] = useState(false);
  const [savingAgrupar, setSavingAgrupar] = useState<BeneficioKey | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  // Última decisão tomada NA LINHA. A prévia abaixo é um componente irmão: sem
  // este repasse ela ficava parada até alguém sair e voltar da tela. O `seq`
  // existe porque aprovar → desfazer → aprovar produz decisões de conteúdo
  // idêntico, e as três precisam valer.
  const [decisao, setDecisao] = useState<(DecisaoAplicada & { seq: number }) | null>(null);

  // ── Validação da diretoria ───────────────────────────────────────────────
  // A validação acontece AQUI, na tela de quem constrói: o diretor escolhe o
  // setor no mesmo seletor e percorre as linhas. Não há tela separada.
  // A VALIDAÇÃO SAIU DO SISTEMA em 24/09/2026 (será redesenhada). Aqui viviam o
  // visto linha a linha, a barra de validação, o cancelamento de colaborador
  // pela diretoria e a barra de "finalizar este setor".



  async function loadColabs(cid: string, y: number, sid: string | null) {
    const res = await getColaboradores(cid, y, sid);
    if (res?.needsMigration) {
      setNeedsMigration(true);
      setItems([]);
      return;
    }
    if (res?.error) {
      setLoadError(res.error);
      setItems([]);
      return;
    }
    setItems(res.items ?? []);
  }

  async function init(cid: string, y: number) {
    setLoading(true);
    setLoadError(null);
    setNeedsMigration(false);
    setFeedback(null);
    if (!cid) {
      setLoading(false);
      return;
    }
    const res = await getPessoalSetup(cid, y);
    if (res?.error) {
      setLoadError(res.error);
      setSetup(EMPTY_SETUP);
      setLoading(false);
      return;
    }
    const s = res.setup ?? EMPTY_SETUP;
    setSetup(s);
    const defaultSetor = s.orcarPorSetor ? s.setores[0]?.id ?? null : null;
    setSetorId(defaultSetor);
    if (!s.orcarPorSetor || defaultSetor) {
      await loadColabs(cid, y, defaultSetor);
    } else {
      setItems([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void init(companyId, year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  /** Agrupar/separar um benefício. Só muda como a prévia monta as linhas — o
   * quadro e os valores digitados ficam intactos. */
  async function handleAgrupar(key: BeneficioKey, agrupar: boolean) {
    const anterior = setup.beneficiosSeparados;
    setFeedback(null);
    setSavingAgrupar(key);
    setSetup((prev) => ({
      ...prev,
      beneficiosSeparados: agrupar
        ? prev.beneficiosSeparados.filter((k) => k !== key)
        : [...prev.beneficiosSeparados, key],
    }));

    const res = await setBeneficioAgrupar(companyId, year, key, agrupar);
    setSavingAgrupar(null);
    if (res?.error || res?.needsMigration) {
      setSetup((prev) => ({ ...prev, beneficiosSeparados: anterior }));
      setFeedback({
        ok: false,
        msg: res.needsMigration
          ? "Migration 20260731140000_orcamento_beneficio_agrupar ainda não aplicada."
          : (res.error as string),
      });
    }
  }

  /** Caixa x competência do ano — só muda como o 13º será distribuído na
   * prévia; não mexe no quadro, então não recarrega os colaboradores. */
  async function handleRegimeChange(value: string) {
    const regime = value as RegimeApuracao;
    const previous = setup.regimeApuracao;
    if (regime === previous) return;

    setFeedback(null);
    setSavingRegime(true);
    setSetup((prev) => ({ ...prev, regimeApuracao: regime }));
    const res = await setRegimeApuracao(companyId, year, regime);
    setSavingRegime(false);
    if (res?.error) {
      setSetup((prev) => ({ ...prev, regimeApuracao: previous }));
      setFeedback({ ok: false, msg: res.error });
    }
  }

  function handleSetorChange(sid: string) {
    setSetorId(sid);
    setFeedback(null);
    setLoading(true);
    void loadColabs(companyId, year, sid).finally(() => setLoading(false));
  }

  async function handleAdd() {
    setAdding(true);
    setFeedback(null);
    const res = await createColaborador(companyId, year, {
      setorId: setorEspecifico(setorId),
      empresaEncargosId: null,
      nome: null,
      vinculo: "clt",
      cargoAtual: null,
      salarioAtual: null,
      mov1: null,
      mov2: null,
      justificativa: null,
    });
    if (res?.error) setFeedback({ ok: false, msg: res.error });
    else await loadColabs(companyId, year, setorId);
    setAdding(false);
  }

  async function handleDelete(colab: Colaborador) {
    if (!window.confirm(`Excluir ${colab.nome ?? "este colaborador"} do quadro?`)) return;
    setFeedback(null);
    const res = await deleteColaborador(colab.id);
    if (res?.error) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    await loadColabs(companyId, year, setorId);
  }

  // Setor concreto da tela: null quando é quadro único OU "Todos os setores".
  function registrarDecisao(d: DecisaoAplicada) {
    setDecisao((antes) => ({ ...d, seq: (antes?.seq ?? 0) + 1 }));
    // O quadro também muda: a linha ganha a marca e trava (ou destrava).
    void loadColabs(companyId, year, setorId);
  }

  const setorAtual = setorEspecifico(setorId);
  const todosSetores = isTodosSetores(setorId);
  // 14 colunas fixas + a de Empresa, que só aparece quando habilitada. O
  // cabeçalho de cada bloco de setor atravessa a tabela inteira.
  const colunasDoQuadro = setup.usarEmpresaEncargos ? 15 : 14;
  const needsSetor = setup.orcarPorSetor && !setorId;
  // Em "Todos os setores" o quadro é só de leitura: um colaborador novo não
  // teria setor a que pertencer.
  const canAdd =
    !loading && !adding && !!companyId && !needsSetor && !needsMigration && !todosSetores;
  // Cargos oferecidos: os do setor selecionado (quando orça por setor) ou os sem
  // setor (plano único). No consolidado, todos, já que as linhas vêm de setores
  // diferentes.
  const cargoOptionsForSetor = !setup.orcarPorSetor
    ? setup.cargoOptions.filter((o) => o.setorId == null)
    : todosSetores
      ? setup.cargoOptions
      : setup.cargoOptions.filter((o) => o.setorId === setorAtual);
  // Como descrever o escopo nas abas de cálculo.
  const escopoLabel = !setup.orcarPorSetor
    ? "esta empresa"
    : todosSetores
      ? "todos os setores"
      : `setor ${setup.setores.find((s) => s.id === setorAtual)?.name ?? ""}`.trim();

  return (
    <div className="space-y-5">
      {/* Regime de apuração + setor (empresa e ano ficam no cabeçalho do workspace) */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Regime de apuração — distribui o 13º (caixa: nov/dez; competência: 1/12).
            SÓ PARA ADMIN: é uma PREMISSA do orçamento, do mesmo naipe do plano de
            cargos e dos encargos, e `setRegimeApuracao` já recusa quem não é
            admin — deixar o seletor à vista era oferecer um controle que só
            levaria a uma recusa, e ainda por cima muda o número da empresa
            inteira. O gestor constrói o quadro; ele não redefine o regime. */}
        {isAdmin && (
          <div className="w-48 space-y-1.5">
            <label className="text-sm font-medium">Regime de apuração</label>
            <select
              value={setup.regimeApuracao}
              onChange={(e) => void handleRegimeChange(e.target.value)}
              disabled={loading || savingRegime || !companyId || needsMigration}
              className={INPUT_CLS}
            >
              {REGIMES_APURACAO.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {setup.orcarPorSetor && setup.setores.length > 0 && (
          <div className="w-56 space-y-1.5">
            <label className="text-sm font-medium">Setor</label>
            <select
              value={setorId ?? ""}
              onChange={(e) => handleSetorChange(e.target.value)}
              disabled={loading}
              className={INPUT_CLS}
            >
              {setup.setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={SETOR_TODOS}>Todos os setores</option>
            </select>
          </div>
        )}
      </div>

      {feedback && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm",
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando quadro…
        </div>
      ) : needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            Rode o <code className="rounded bg-muted px-1 py-0.5">db push</code> da migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">20260729140000_orcamento_pessoal_quadro</code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : setup.orcarPorSetor && setup.setores.length === 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          Esta empresa orça <strong>por setor</strong> em {year}, mas não há setores cadastrados.
          Cadastre-os em <strong>Configurações → Setores</strong> para montar o quadro de cada um.
        </div>
      ) : (
        <>
          {/* Abas: Quadro (azul) | Benefícios (verde) | Colaborador | Prévia */}
          <div className="flex gap-1 border-b">
            {TABS.filter((t) => !t.adminOnly || isAdmin).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-emerald-600 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "previa" ? (
            <PreviaPessoal
              companyId={companyId}
              year={year}
              setorId={setorId}
              escopoLabel={escopoLabel}
            />
          ) : tab === "colaborador" ? (
            <ColaboradorDetalhe
              companyId={companyId}
              year={year}
              setorId={setorId}
              escopoLabel={escopoLabel}
            />
          ) : tab === "quadro" || !isAdmin ? (
            /* `|| !isAdmin`: esconder o botão da aba não é a única defesa — o
               estado poderia apontar para Benefícios (troca de perfil, estado
               antigo) e a tabela renderizaria assim mesmo. Quem não é admin
               sempre cai no Quadro. */
            <>
              {cargoOptionsForSetor.length === 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm text-muted-foreground">
                  Nenhum cargo/nível no <strong>Plano de Cargos</strong>
                  {setup.orcarPorSetor ? " deste setor" : ""} em {year}. Cadastre-os para que o
                  salário seja preenchido automaticamente ao escolher o cargo.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {items.length} colaborador(es)
                  {setup.orcarPorSetor ? (todosSetores ? " na empresa" : " neste setor") : ""}.
                  Edite direto na tabela — cada alteração é salva automaticamente.
                  {todosSetores && " Escolha um setor para adicionar alguém."}
                </p>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!canAdd}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Adicionar colaborador
                </button>
              </div>

              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
                  Nenhum colaborador no quadro. Use <strong>Adicionar colaborador</strong> para
                  começar.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="min-w-[1040px] w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th
                          className="border-r px-2 py-2 text-left"
                          colSpan={setup.usarEmpresaEncargos ? 3 : 2}
                        >
                          Colaborador
                        </th>
                        <th className="border-r px-2 py-2 text-left" colSpan={2}>
                          Situação atual
                        </th>
                        <th className="border-r bg-sky-500/10 px-2 py-2 text-left" colSpan={4}>
                          Movimentação 1
                        </th>
                        <th
                          className="border-r border-l-2 border-l-violet-400/50 bg-violet-500/10 px-2 py-2 text-left"
                          colSpan={4}
                        >
                          Movimentação 2
                        </th>
                        <th className="border-r px-2 py-2 text-left">Justificativa</th>
                        <th className="px-2 py-2" />
                      </tr>
                      <tr className="border-b bg-muted/20 text-[11px] font-medium text-muted-foreground">
                        {setup.usarEmpresaEncargos && (
                          <th
                            className="border-r px-2 py-1.5 text-left"
                            title="Empresa em que o colaborador é registrado — define o regime tributário dos encargos dele. O custo continua indo para a empresa filtrada."
                          >
                            Empresa
                          </th>
                        )}
                        <th className="border-r px-2 py-1.5 text-left">Nome</th>
                        <th className="border-r px-2 py-1.5 text-left">Vínculo</th>
                        <th className="border-r px-2 py-1.5 text-left">Cargo atual</th>
                        <th className="border-r px-2 py-1.5 text-left">Salário</th>
                        <th className="border-r px-2 py-1.5 text-left">Tipo</th>
                        <th className="border-r px-2 py-1.5 text-left">Mês</th>
                        <th className="border-r px-2 py-1.5 text-left">Cargo</th>
                        <th className="border-r px-2 py-1.5 text-left">Salário</th>
                        <th className="border-r px-2 py-1.5 text-left">Tipo</th>
                        <th className="border-r px-2 py-1.5 text-left">Mês</th>
                        <th className="border-r px-2 py-1.5 text-left">Cargo</th>
                        <th className="border-r px-2 py-1.5 text-left">Salário</th>
                        <th className="border-r px-2 py-1.5 text-left">Motivo</th>
                        <th className="px-2 py-1.5" />
                      </tr>
                    </thead>
                    {/* Em "Todos os setores" o quadro vem em BLOCOS, um por
                        setor: ver todo mundo numa tela só é metade do pedido —
                        sem a separação, as linhas viram uma lista em que nada
                        diz de quem é cada um. Num setor só, a tabela segue
                        corrida (o cabeçalho da tela já nomeia o setor). */}
                    {todosSetores ? (
                      agruparPorSetor(items, setup.setores).map((bloco) => (
                        <tbody key={bloco.setorId ?? "__sem__"} className="divide-y">
                          <tr className="border-y bg-muted/50">
                            <td colSpan={colunasDoQuadro} className="px-3 py-1.5">
                              <span className="text-xs font-semibold uppercase tracking-wide">
                                {bloco.nome}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {bloco.itens.length} colaborador(es)
                              </span>
                            </td>
                          </tr>
                          {bloco.itens.map((colab) => (
                            <ColaboradorRow
                              key={colab.id}
                              colab={colab}
                              companyId={companyId}
                              podeValidar={podeValidar}
                              year={year}
                              cargoOptions={cargoOptionsForSetor}
                              empresas={setup.empresas}
                              mostrarEmpresa={setup.usarEmpresaEncargos}
                              onError={(msg) => setFeedback({ ok: false, msg })}
                              onDelete={() => handleDelete(colab)}
                              isAdmin={isAdmin}
                              onReativado={() => void loadColabs(companyId, year, setorId)}
                              onDecidiu={registrarDecisao}
                            />
                          ))}
                        </tbody>
                      ))
                    ) : (
                      <tbody className="divide-y">
                        {items.map((colab) => (
                          <ColaboradorRow
                            key={colab.id}
                            colab={colab}
                            companyId={companyId}
                            podeValidar={podeValidar}
                            year={year}
                            cargoOptions={cargoOptionsForSetor}
                            empresas={setup.empresas}
                            mostrarEmpresa={setup.usarEmpresaEncargos}
                            onError={(msg) => setFeedback({ ok: false, msg })}
                            onDelete={() => handleDelete(colab)}
                            isAdmin={isAdmin}
                            onReativado={() => void loadColabs(companyId, year, setorId)}
                            onDecidiu={registrarDecisao}
                          />
                        ))}
                      </tbody>
                    )}
                  </table>
                </div>
              )}
            </>
          ) : (
            /* Aba Benefícios (parte verde) — valores mensais por colaborador */
            <>
              <p className="text-sm text-muted-foreground">
                Valores <strong>mensais</strong> por colaborador, definidos pelo{" "}
                <strong>administrador</strong> — cada alteração é salva automaticamente. Adicione/remova pessoas na aba{" "}
                <strong>Quadro</strong>. <em>Seguro de vida</em> só se aplica a colaboradores com
                vínculo <strong>Estágio</strong>. O check <strong>Agrupar</strong> no topo de cada
                coluna decide se o benefício soma na linha “Benefícios” da prévia ou vira uma linha
                própria, com conta própria no orçamento.
              </p>

              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
                  Nenhum colaborador. Cadastre-os na aba <strong>Quadro</strong> primeiro.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="min-w-[820px] w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-emerald-500/10 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <th className="border-r px-3 py-2 text-left">Colaborador</th>
                        {BENEFICIOS.map((b) => {
                          const agrupado = !setup.beneficiosSeparados.includes(b.key);
                          return (
                            <th key={b.key} className="border-r px-3 py-2 text-left align-top">
                              <div className="space-y-1">
                                <div>{b.label}</div>
                                <label
                                  className="flex cursor-pointer items-center gap-1 text-[10px] font-normal normal-case"
                                  title="Agrupado soma na linha “Benefícios” da prévia; desmarcado vira uma linha própria, com conta própria no orçamento."
                                >
                                  <input
                                    type="checkbox"
                                    checked={agrupado}
                                    disabled={savingAgrupar === b.key}
                                    onChange={(e) => void handleAgrupar(b.key, e.target.checked)}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  Agrupar
                                  {savingAgrupar === b.key && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  )}
                                </label>
                              </div>
                            </th>
                          );
                        })}
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    {/* Mesma separação por setor do Quadro: no consolidado,
                        lista corrida não diz de quem é cada linha. */}
                    {todosSetores ? (
                      agruparPorSetor(items, setup.setores).map((bloco) => (
                        <tbody key={bloco.setorId ?? "__sem__"} className="divide-y">
                          <tr className="border-y bg-muted/50">
                            <td colSpan={BENEFICIOS.length + 2} className="px-3 py-1.5">
                              <span className="text-xs font-semibold uppercase tracking-wide">
                                {bloco.nome}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {bloco.itens.length} colaborador(es)
                              </span>
                            </td>
                          </tr>
                          {bloco.itens.map((colab) => (
                            <BeneficioRow
                              key={colab.id}
                              colab={colab}
                              onError={(msg) => setFeedback({ ok: false, msg })}
                            />
                          ))}
                        </tbody>
                      ))
                    ) : (
                      <tbody className="divide-y">
                        {items.map((colab) => (
                          <BeneficioRow
                            key={colab.id}
                            colab={colab}
                            onError={(msg) => setFeedback({ ok: false, msg })}
                          />
                        ))}
                      </tbody>
                    )}
                  </table>
                </div>
              )}
            </>
          )}

          {/* A PRÉVIA DO SETOR, logo abaixo do quadro. Fica aqui e não numa
              aba porque o ✓ de cada linha mexe nela: decidir num lugar e ver
              o efeito noutro obrigava a trocar de aba a cada aprovação. É o
              mesmo componente da montagem do Planejamento. */}
          {(tab === "quadro" || tab === "beneficios") && (
            <ValidacaoSetorPainel
              companyId={companyId}
              year={year}
              setorId={setorId}
              setorNome={setup.setores.find((x) => x.id === setorAtual)?.name ?? ""}
              decisaoExterna={decisao ?? undefined}
            />
          )}
        </>
      )}

    </div>
  );
}

// ─── Linha editável (auto-save) ──────────────────────────────────────────────

/** Rótulo curto do regime, para caber no <option> da coluna Empresa. */
function regimeCurto(regime: string): string {
  if (regime === "simples_nacional") return "Simples";
  if (regime === "lucro_presumido") return "Presumido";
  if (regime === "lucro_real") return "Real";
  return regime;
}

interface RowDraft {
  empresaEncargosId: string;
  nome: string;
  vinculo: VinculoKey;
  cargoAtual: string;
  salarioAtual: string;
  mov1Tipo: "" | MovTipo;
  mov1Mes: string;
  mov1Cargo: string;
  mov1Salario: string;
  mov2Tipo: "" | MovTipo;
  mov2Mes: string;
  mov2Cargo: string;
  mov2Salario: string;
  justificativa: string;
}

function toDraft(c: Colaborador): RowDraft {
  return {
    empresaEncargosId: c.empresaEncargosId ?? "",
    nome: c.nome ?? "",
    vinculo: c.vinculo,
    cargoAtual: c.cargoAtual ?? "",
    salarioAtual: numberToInput(c.salarioAtual),
    mov1Tipo: c.mov1?.tipo ?? "",
    mov1Mes: isoToMes(c.mov1?.data ?? null),
    mov1Cargo: c.mov1?.cargo ?? "",
    mov1Salario: numberToInput(c.mov1?.salario ?? null),
    mov2Tipo: c.mov2?.tipo ?? "",
    mov2Mes: isoToMes(c.mov2?.data ?? null),
    mov2Cargo: c.mov2?.cargo ?? "",
    mov2Salario: numberToInput(c.mov2?.salario ?? null),
    justificativa: c.justificativa ?? "",
  };
}

function draftToInput(d: RowDraft, setorId: string | null, year: number): ColaboradorInput {
  return {
    setorId,
    empresaEncargosId: d.empresaEncargosId || null,
    nome: d.nome.trim() || null,
    vinculo: d.vinculo,
    cargoAtual: d.cargoAtual.trim() || null,
    salarioAtual: readSalario(d.salarioAtual),
    mov1: buildMov(d.mov1Tipo, d.mov1Mes, d.mov1Cargo, d.mov1Salario, year),
    mov2: buildMov(d.mov2Tipo, d.mov2Mes, d.mov2Cargo, d.mov2Salario, year),
    justificativa: d.justificativa.trim() || null,
  };
}

interface RowProps {
  colab: Colaborador;
  companyId: string;
  year: number;
  /** Quem vê decide? Mostra os botões ✓ / ✗ / comentário na linha. */
  podeValidar: boolean;
  cargoOptions: CargoOption[];
  empresas: EmpresaEncargosOption[];
  mostrarEmpresa: boolean;
  onError: (msg: string) => void;
  onDelete: () => void;
  /** Admin: mostra o botão que limpa as marcas da diretoria. */
  isAdmin: boolean;
  onReativado: () => void;
  /** Decisão da diretoria nesta linha — recarrega o quadro e move a prévia. */
  onDecidiu: (d: DecisaoAplicada) => void;
}

function ColaboradorRow({
  colab,
  companyId,
  podeValidar,
  year,
  cargoOptions,
  empresas,
  mostrarEmpresa,
  onError,
  onDelete,
  isAdmin,
  onReativado,
  onDecidiu,
}: RowProps) {

  const [draft, setDraft] = useState<RowDraft>(() => toDraft(colab));
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(false);

  async function persist(next: RowDraft) {
    setSaving(true);
    // O setor gravado é o DA LINHA, não o do filtro da tela — em "Todos os
    // setores" o filtro não é um setor, e editar não deve mover ninguém.
    const res = await updateColaborador(colab.id, draftToInput(next, colab.setorId, year));
    setSaving(false);
    if (res?.error) onError(res.error);
  }

  // Edita localmente sem gravar (para digitação); grava no blur.
  function edit(patch: Partial<RowDraft>) {
    dirtyRef.current = true;
    setDraft((prev) => ({ ...prev, ...patch }));
  }
  // Grava imediatamente (para selects e auto-preenchimentos).
  function commit(patch: Partial<RowDraft>) {
    const next = { ...draftRef.current, ...patch };
    dirtyRef.current = false;
    setDraft(next);
    void persist(next);
  }
  function blurCommit() {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void persist(draftRef.current);
  }

  const cargoValue = (v: string) => (cargoOptions.some((o) => o.label === v) ? v : "");

  function movCargoChange(field: "mov1" | "mov2", label: string) {
    const opt = cargoOptions.find((o) => o.label === label);
    commit(
      field === "mov1"
        ? { mov1Cargo: label, mov1Salario: opt ? numberToInput(opt.salario) : draftRef.current.mov1Salario }
        : { mov2Cargo: label, mov2Salario: opt ? numberToInput(opt.salario) : draftRef.current.mov2Salario },
    );
  }

  /** PJ/Estágio preenchem o cargo atual com o próprio vínculo (não têm cargo do
   * plano). Ao voltar para CLT, limpa esse cargo automático para escolher do plano. */
  function vinculoChange(v: VinculoKey) {
    if (v === "pj" || v === "estagio") {
      commit({ vinculo: v, cargoAtual: v === "pj" ? "PJ" : "Estágio" });
    } else {
      const cur = draftRef.current.cargoAtual;
      commit({ vinculo: v, cargoAtual: cur === "PJ" || cur === "Estágio" ? "" : cur });
    }
  }

  /** Troca o tipo da movimentação. Sem tipo, limpa a faixa inteira; no
   * desligamento, zera cargo e salário (que não se aplicam). Admissão e
   * movimentação de cargo mantêm as duas células liberadas. */
  function movTipoChange(field: "mov1" | "mov2", value: string) {
    const tipo = (value as "" | MovTipo) || "";
    const patch: Partial<RowDraft> =
      tipo === ""
        ? { [`${field}Tipo`]: "", [`${field}Mes`]: "", [`${field}Cargo`]: "", [`${field}Salario`]: "" }
        : movTemCargo(tipo)
          ? { [`${field}Tipo`]: tipo }
          : { [`${field}Tipo`]: tipo, [`${field}Cargo`]: "", [`${field}Salario`]: "" };
    commit(patch);
  }

  const mov1IsMov = Boolean(draft.mov1Tipo) && movTemCargo(draft.mov1Tipo as MovTipo);
  const mov2IsMov = Boolean(draft.mov2Tipo) && movTemCargo(draft.mov2Tipo as MovTipo);
  // PJ e Estágio não escolhem cargo do plano: o cargo atual é o próprio vínculo.
  const cargoIsAuto = draft.vinculo === "pj" || draft.vinculo === "estagio";

  // Estado da diretoria. O CANCELADO fica visível e riscado (cancelar é marca,
  // não exclusão) e o TRAVADO não aceita edição — sem isto o gestor digitaria e
  // levaria erro só ao salvar, o que parece defeito.
  const cancelado = Boolean(colab.canceladoEm);
  // DERIVA da decisão da diretoria (aprovado/reprovado), não da coluna morta
  // `diretoria_travado` — ver validacao-diretoria.ts.
  const travado = colab.travado;
  const bloqueado = cancelado || travado;

  return (
    <tr
      className={cn(
        "align-top hover:bg-muted/20",
        cancelado && "bg-muted/30 opacity-60 [&_input]:line-through [&_select]:line-through",
        travado && !cancelado && colab.estado === "aprovado" && "bg-emerald-500/[0.04]",
        travado && !cancelado && colab.estado === "reprovado" && "bg-destructive/[0.04]",
        colab.estado === "revisar" && !cancelado && "bg-sky-500/[0.05]",
        // Campos travados enquanto a marca da diretoria existir — mas NUNCA
        // os botões: era isso que impedia até de excluir a linha, deixando o
        // colaborador cancelado sem nenhum caminho de saída pela tela.
        //
        // O admin passa por cima: com a validação fora do sistema, ele é o
        // único que pode desfazer a decisão (`reativarColaborador`).
        bloqueado && !isAdmin &&
          "[&_input]:pointer-events-none [&_select]:pointer-events-none",
      )}
      aria-disabled={(bloqueado && !isAdmin) || undefined}
      title={
        cancelado
          ? `Cancelado pela diretoria${colab.canceladoMotivo ? `: ${colab.canceladoMotivo}` : ""}`
          : travado
            ? colab.estado === "aprovado"
              ? "Aprovado pela diretoria. Só um diretor ou o administrador altera."
              : "Reprovado pela diretoria. Só um diretor ou o administrador altera."
            : undefined
      }
    >
      {/* Empresa dos encargos — só aparece quando habilitada na configuração.
          Vazio significa a empresa do quadro. */}
      {mostrarEmpresa && (
        <td className="border-r px-1.5 py-1">
          <select
            value={draft.empresaEncargosId}
            onChange={(e) => commit({ empresaEncargosId: e.target.value })}
            className={cn(CELL, "min-w-[10rem]")}
            title="Regime tributário usado nos encargos deste colaborador"
          >
            <option value="">— esta empresa —</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.regimeTributario ? ` (${regimeCurto(e.regimeTributario)})` : ""}
              </option>
            ))}
          </select>
        </td>
      )}
      {/* Nome */}
      <td className="border-r px-1.5 py-1">
        <input
          value={draft.nome}
          onChange={(e) => edit({ nome: e.target.value })}
          onBlur={blurCommit}
          placeholder="Nome"
          className={cn(CELL, "min-w-[9rem]")}
        />
      </td>
      {/* Vínculo */}
      <td className="border-r px-1.5 py-1">
        <select
          value={draft.vinculo}
          onChange={(e) => vinculoChange(e.target.value as VinculoKey)}
          className={cn(CELL, "min-w-[5rem]")}
        >
          {VINCULOS.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
      </td>
      {/* Cargo atual — PJ/Estágio ficam travados no próprio vínculo */}
      <td className="border-r px-1.5 py-1">
        {cargoIsAuto ? (
          <input
            value={draft.cargoAtual}
            readOnly
            disabled
            className={cn(CELL, "min-w-[11rem] italic")}
          />
        ) : (
          <select
            value={cargoValue(draft.cargoAtual)}
            onChange={(e) => {
              const label = e.target.value;
              const opt = cargoOptions.find((o) => o.label === label);
              commit({
                cargoAtual: label,
                salarioAtual: opt ? numberToInput(opt.salario) : draftRef.current.salarioAtual,
              });
            }}
            className={cn(CELL, "min-w-[11rem]")}
          >
            <option value="">— cargo —</option>
            {cargoOptions.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </td>
      {/* Salário atual */}
      <td className="border-r px-1.5 py-1">
        <CurrencyCell
          value={draft.salarioAtual}
          onChange={(v) => edit({ salarioAtual: v })}
          onBlur={blurCommit}
          className={cn(CELL, "min-w-[7rem] text-right tabular-nums")}
        />
      </td>

      {/* Movimentação 1 */}
      <td className="border-r bg-sky-500/[0.04] px-1.5 py-1">
        <select
          value={draft.mov1Tipo}
          onChange={(e) => movTipoChange("mov1", e.target.value)}
          className={cn(CELL, "min-w-[7rem]")}
        >
          <option value="">—</option>
          {MOV_TIPOS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-r bg-sky-500/[0.04] px-1.5 py-1">
        <select
          value={draft.mov1Mes}
          onChange={(e) => commit({ mov1Mes: e.target.value })}
          disabled={!draft.mov1Tipo}
          className={cn(CELL, "min-w-[4.5rem]")}
        >
          <option value="">—</option>
          {MES_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-r bg-sky-500/[0.04] px-1.5 py-1">
        <select
          value={cargoValue(draft.mov1Cargo)}
          onChange={(e) => movCargoChange("mov1", e.target.value)}
          disabled={!mov1IsMov}
          className={cn(CELL, "min-w-[11rem]")}
        >
          <option value="">— cargo —</option>
          {cargoOptions.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-r bg-sky-500/[0.04] px-1.5 py-1">
        <CurrencyCell
          value={draft.mov1Salario}
          onChange={(v) => edit({ mov1Salario: v })}
          onBlur={blurCommit}
          disabled={!mov1IsMov}
          className={cn(CELL, "min-w-[7rem] text-right tabular-nums")}
        />
      </td>

      {/* Movimentação 2 (cor distinta para marcar a divisão) */}
      <td className="border-r border-l-2 border-l-violet-400/50 bg-violet-500/[0.06] px-1.5 py-1">
        <select
          value={draft.mov2Tipo}
          onChange={(e) => movTipoChange("mov2", e.target.value)}
          className={cn(CELL, "min-w-[7rem]")}
        >
          <option value="">—</option>
          {MOV_TIPOS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-r bg-violet-500/[0.06] px-1.5 py-1">
        <select
          value={draft.mov2Mes}
          onChange={(e) => commit({ mov2Mes: e.target.value })}
          disabled={!draft.mov2Tipo}
          className={cn(CELL, "min-w-[4.5rem]")}
        >
          <option value="">—</option>
          {MES_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-r bg-violet-500/[0.06] px-1.5 py-1">
        <select
          value={cargoValue(draft.mov2Cargo)}
          onChange={(e) => movCargoChange("mov2", e.target.value)}
          disabled={!mov2IsMov}
          className={cn(CELL, "min-w-[11rem]")}
        >
          <option value="">— cargo —</option>
          {cargoOptions.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-r bg-violet-500/[0.06] px-1.5 py-1">
        <CurrencyCell
          value={draft.mov2Salario}
          onChange={(v) => edit({ mov2Salario: v })}
          onBlur={blurCommit}
          disabled={!mov2IsMov}
          className={cn(CELL, "min-w-[7rem] text-right tabular-nums")}
        />
      </td>

      {/* Justificativa */}
      <td className="border-r px-1.5 py-1">
        <input
          value={draft.justificativa}
          onChange={(e) => edit({ justificativa: e.target.value })}
          onBlur={blurCommit}
          placeholder="Motivo"
          className={cn(CELL, "min-w-[12rem]")}
        />
      </td>

      {/* Ações */}
      <td className="px-1.5 py-1 text-center">
        <div className="flex items-center justify-center gap-1">
          {/* Decisão da diretoria, na PRÓPRIA LINHA — mesmo gesto do
              Planejamento dos gestores. Um ✓ aprova a pessoa inteira: salário,
              encargos e benefícios, porque o motor é linear por colaborador. */}
          <DecisaoColaborador
            colab={colab}
            companyId={companyId}
            year={year}
            podeValidar={podeValidar}
            onError={onError}
            onDecidiu={onDecidiu}
          />
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              {bloqueado && isAdmin && (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await reativarColaborador(colab.id);
                    if (res?.error) onError(res.error);
                    else onReativado();
                  }}
                  title="Desfazer o cancelamento/travamento da diretoria"
                  className="rounded p-1 text-amber-700 hover:bg-muted"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onDelete}
                title="Excluir colaborador"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Linha de benefícios (parte verde, auto-save) ────────────────────────────

function initBenef(colab: Colaborador): Record<string, string> {
  const d: Record<string, string> = {};
  for (const b of BENEFICIOS) d[b.key] = numberToInput(colab.beneficios[b.key]);
  return d;
}

function BeneficioRow({
  colab,
  onError,
}: {
  colab: Colaborador;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => initBenef(colab));
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(false);

  // Benefício aplicável ao colaborador (ex.: seguro de vida só para Estágio).
  const enabledFor = (b: (typeof BENEFICIOS)[number]) =>
    !b.onlyVinculo || colab.vinculo === b.onlyVinculo;

  async function persist() {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    const values = {} as Beneficios;
    for (const b of BENEFICIOS) {
      values[b.key] = enabledFor(b) ? readSalario(draftRef.current[b.key] ?? "") : null;
    }
    const res = await updateColaboradorBeneficios(colab.id, values);
    setSaving(false);
    if (res?.error) onError(res.error);
  }

  return (
    <tr className="align-middle hover:bg-muted/20">
      <td className="border-r px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{colab.nome ?? "Sem nome"}</span>
          <span className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {vinculoLabel(colab.vinculo)}
          </span>
        </div>
      </td>
      {BENEFICIOS.map((b) =>
        enabledFor(b) ? (
          <td key={b.key} className="border-r px-2 py-1">
            <CurrencyCell
              value={draft[b.key] ?? ""}
              onChange={(v) => {
                dirtyRef.current = true;
                setDraft((prev) => ({ ...prev, [b.key]: v }));
              }}
              onBlur={persist}
              className={cn(CELL, "min-w-[7rem] text-right tabular-nums")}
            />
          </td>
        ) : (
          <td key={b.key} className="border-r px-2 py-1 text-center text-xs text-muted-foreground">
            —
          </td>
        ),
      )}
      <td className="px-2 py-1 text-center">
        {saving && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />}
      </td>
    </tr>
  );
}

/**
 * A decisão da diretoria NA LINHA do colaborador — ✓ aprovar, ✗ reprovar e 💬
 * pedir revisão, o mesmo gesto do Planejamento dos gestores.
 *
 * Um ✓ aprova a PESSOA inteira: salário, encargos, férias, 13º e benefícios.
 * Isso é exato, não rateio, porque o motor do pessoal roda por colaborador e a
 * soma das partes reproduz o agregado (ver `previa-budget.ts`).
 *
 * Quem não decide vê só a marca do estado — é como ele descobre por que a
 * linha ficou travada, em vez de digitar e levar erro ao salvar.
 */
function DecisaoColaborador({
  colab,
  companyId,
  year,
  podeValidar,
  onError,
  onDecidiu,
}: {
  colab: Colaborador;
  companyId: string;
  year: number;
  podeValidar: boolean;
  onError: (msg: string) => void;
  /** Avisa QUAL foi a decisão, para a prévia abaixo antecipá-la sem refetch. */
  onDecidiu: (d: DecisaoAplicada) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [texto, setTexto] = useState("");

  async function decidir(status: "aprovado" | "reprovado" | "revisar", comentario?: string) {
    setSalvando(true);
    const res = await decidirItem({
      companyId,
      year,
      alvoTipo: "colaborador",
      alvoId: colab.id,
      setorId: colab.setorId,
      alvoRotulo: colab.nome?.trim() || colab.cargoAtual?.trim() || "Colaborador",
      status,
      comentario,
    });
    setSalvando(false);
    if (res.error) {
      onError(res.error);
      return;
    }
    setPedindo(false);
    setTexto("");
    onDecidiu({
      alvoTipo: "colaborador",
      alvoId: colab.id,
      estado: status,
      comentario: comentario ?? null,
    });
  }

  if (!podeValidar) {
    // Sem decisão não há o que mostrar: no começo do orçamento TODA linha está
    // pendente, e uma marca em cada uma viraria ruído.
    if (colab.estado === "pendente") return null;
    return (
      <span
        title={colab.comentario ?? ESTADO_LABEL[colab.estado]}
        className={cn(
          "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
          colab.estado === "aprovado" &&
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          colab.estado === "reprovado" && "border-destructive/40 bg-destructive/10 text-destructive",
          colab.estado === "revisar" && "border-sky-500/40 bg-sky-500/10 text-sky-700",
        )}
      >
        {colab.estado === "revisar" ? "revisar" : colab.estado}
      </span>
    );
  }

  return (
    <>
      <span className="flex shrink-0 items-center gap-0.5">
        <BotaoDecisaoColab
          titulo="Aprovar"
          ativo={colab.estado === "aprovado"}
          classeAtiva="bg-emerald-500 text-white"
          classeHover="hover:bg-emerald-500/15 hover:text-emerald-700"
          disabled={salvando}
          onClick={() => void decidir("aprovado")}
        >
          <Check className="h-3.5 w-3.5" />
        </BotaoDecisaoColab>
        <BotaoDecisaoColab
          titulo="Reprovar"
          ativo={colab.estado === "reprovado"}
          classeAtiva="bg-destructive text-white"
          classeHover="hover:bg-destructive/15 hover:text-destructive"
          disabled={salvando}
          onClick={() => void decidir("reprovado")}
        >
          <X className="h-3.5 w-3.5" />
        </BotaoDecisaoColab>
        <BotaoDecisaoColab
          titulo={colab.comentario ? `Revisar: ${colab.comentario}` : "Pedir revisão"}
          ativo={colab.estado === "revisar"}
          classeAtiva="bg-sky-500 text-white"
          classeHover="hover:bg-sky-500/15 hover:text-sky-700"
          disabled={salvando}
          onClick={() => setPedindo(true)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </BotaoDecisaoColab>
      </span>

      <Dialog open={pedindo} onOpenChange={(o) => !o && setPedindo(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir revisão</DialogTitle>
            <DialogDescription>
              {colab.nome?.trim() || "Colaborador"} — o gestor volta a poder editar esta linha e vê
              o seu comentário.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            autoFocus
            placeholder="O que precisa mudar?"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPedindo(false)}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={salvando || texto.trim() === ""}
              onClick={() => void decidir("revisar", texto)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              Enviar ao gestor
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BotaoDecisaoColab({
  titulo,
  ativo,
  classeAtiva,
  classeHover,
  disabled,
  onClick,
  children,
}: {
  titulo: string;
  ativo: boolean;
  classeAtiva: string;
  classeHover: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-40",
        ativo ? `${classeAtiva} border-transparent` : `border-transparent text-muted-foreground ${classeHover}`,
      )}
    >
      {children}
    </button>
  );
}
