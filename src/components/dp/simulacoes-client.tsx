"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Briefcase, Scale, TrendingUp, Trash2, UserPlus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rotuloLinha, type DpLinhaSalarial } from "@/lib/dp/cargos";
import type { DpEncargosEmpresa } from "@/lib/dp/encargos-dp";
import { custoMensal, simularCenario, vinculoDeCusto, type DpItemCenario, type DpPessoaSim, type DpVinculoCusto } from "@/lib/dp/simulacao";
import { lerSalario } from "@/lib/dp/tabela-salarial";
import { ENCARGOS } from "@/lib/orcamento/encargos";
import { formatBRL } from "@/lib/orcamento/format";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const inputCls = "rounded-md border border-input bg-background px-2 py-1 text-sm";
const botaoCls =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-surface-2 disabled:opacity-50";

let seq = 0;
const novoId = () => `i${Date.now().toString(36)}${(seq += 1)}`;

function sinal(v: number): string {
  return `${v > 0 ? "+" : ""}${formatBRL(v)}`;
}

export function DpSimulacoesClient({
  companyName,
  ano,
  pessoas,
  tabela,
  encargos,
}: {
  companyName: string;
  ano: number;
  pessoas: DpPessoaSim[];
  tabela: DpLinhaSalarial[];
  encargos: DpEncargosEmpresa;
}) {
  const [itens, setItens] = useState<DpItemCenario[]>([]);
  // Padrão: o mês seguinte — decisão de hoje costuma valer na próxima folha.
  const [mesVigencia, setMesVigencia] = useState(() => Math.min(12, new Date().getMonth() + 2));

  const resultado = useMemo(
    () => simularCenario({ pessoas, itens, encargos: encargos.values, mesVigencia }),
    [pessoas, itens, encargos.values, mesVigencia],
  );
  const efeito = useMemo(() => new Map(resultado.porItem.map((e) => [e.itemId, e])), [resultado.porItem]);

  const comSalario = pessoas.filter((p) => p.salario !== null && p.salario > 0);
  const departamentos = useMemo(
    () => Array.from(new Set(comSalario.map((p) => p.departamento ?? ""))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [comSalario],
  );
  const abaixo = comSalario.filter((p) => p.salarioTabela !== null && p.salario! + 0.005 < p.salarioTabela).length;

  const atualizar = (id: string, patch: Partial<DpItemCenario>) =>
    setItens((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as DpItemCenario) : x)));
  const remover = (id: string) => setItens((xs) => xs.filter((x) => x.id !== id));
  const adicionar = (item: DpItemCenario) => setItens((xs) => [...xs, item]);

  const enc = encargos.values;
  const exemplo = custoMensal(1000, "clt", enc).total;

  return (
    <div className="space-y-4">
      {/* Premissas */}
      <Card>
        <CardContent className="space-y-1 py-4 text-sm">
          <p className="text-ink-primary">
            <strong>{companyName}</strong> — custo atual da folha:{" "}
            <strong className="tabular-nums">{formatBRL(resultado.custoAtual)}</strong> por mês (com encargos, 13º e terço de
            férias provisionados), {comSalario.length} pessoa(s).
          </p>
          <p className="text-ink-muted">
            Alíquotas:{" "}
            {ENCARGOS.map((m) => `${m.label} ${enc[m.key].toLocaleString("pt-BR")}%`).join(" · ")} —{" "}
            {encargos.origem.tipo === "cadastro"
              ? `cadastro de encargos do Orçamento (${encargos.origem.ano})`
              : `padrão do regime tributário (${encargos.origem.regime ?? "não informado"}), sem cadastro no Orçamento`}
            . Para um CLT, cada R$ 1.000 de salário custa {formatBRL(exemplo)} por mês.
          </p>
          <p className="text-xs text-ink-muted">
            Benefícios não entram (o DP não tem o benefício de cada pessoa).
            {resultado.semSalario > 0 && ` ${resultado.semSalario} pessoa(s) sem salário na Sólides ficam fora da conta.`}
            {resultado.presumidosClt > 0 && ` ${resultado.presumidosClt} sem tipo de contrato contadas como CLT.`} Sócio, prestador e
            estágio entram só com o valor, sem encargos — mesma regra do Orçamento.
          </p>
        </CardContent>
      </Card>

      {/* Montagem do cenário */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Cenário</CardTitle>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Vale a partir de</span>
              <select value={mesVigencia} onChange={(e) => setMesVigencia(Number(e.target.value))} className={inputCls}>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}/{ano}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm text-ink-muted">
            Os itens são aplicados em ordem, cada um sobre o resultado do anterior. Nada é gravado — o cenário fica só nesta tela.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={botaoCls}
              onClick={() => adicionar({ id: novoId(), tipo: "aumento", percentual: 5, alvo: "todos" })}
            >
              <TrendingUp className="h-4 w-4" /> Aumento
            </button>
            <button
              type="button"
              className={botaoCls}
              disabled={comSalario.length === 0}
              onClick={() => adicionar({ id: novoId(), tipo: "promocao", pessoaId: comSalario[0]?.id ?? "", novoSalario: comSalario[0]?.salario ?? 0 })}
            >
              <ArrowUpRight className="h-4 w-4" /> Promoção
            </button>
            <button
              type="button"
              className={botaoCls}
              onClick={() =>
                adicionar({
                  id: novoId(),
                  tipo: "contratacao",
                  quantidade: 1,
                  salario: tabela[0]?.salario ?? 0,
                  vinculo: "clt",
                  rotulo: tabela[0] ? rotuloLinha(tabela[0]) : "Contratação",
                })
              }
            >
              <UserPlus className="h-4 w-4" /> Contratação
            </button>
            <button
              type="button"
              className={botaoCls}
              disabled={abaixo === 0 || itens.some((i) => i.tipo === "enquadrar")}
              title={abaixo === 0 ? "Ninguém desta empresa está abaixo do salário da tabela (ou falta vincular os cargos)" : undefined}
              onClick={() => adicionar({ id: novoId(), tipo: "enquadrar" })}
            >
              <Scale className="h-4 w-4" /> Levar à tabela quem está abaixo ({abaixo})
            </button>
          </div>

          {itens.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-muted">Adicione um item para simular.</p>
          ) : (
            <ol className="space-y-2">
              {itens.map((item, i) => (
                <li key={item.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="mt-1 text-xs font-medium text-ink-muted">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <ItemEditor
                        item={item}
                        pessoas={comSalario}
                        departamentos={departamentos}
                        tabela={tabela}
                        atualizar={(patch) => atualizar(item.id, patch)}
                      />
                    </div>
                    <div className="text-right text-sm">
                      <div className="tabular-nums font-medium text-ink-primary">{sinal(efeito.get(item.id)?.deltaMensal ?? 0)}/mês</div>
                      <div className="text-xs text-ink-muted">{efeito.get(item.id)?.pessoas ?? 0} pessoa(s)</div>
                    </div>
                    <button type="button" onClick={() => remover(item.id)} className="rounded p-1 text-ink-muted hover:text-red-600" aria-label="Remover item">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Resultado */}
      {itens.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Custo simulado (mês)" valor={formatBRL(resultado.custoSimulado)} nota={`atual ${formatBRL(resultado.custoAtual)}`} />
            <Stat label="Diferença por mês" valor={sinal(resultado.deltaMensal)} destaque />
            <Stat
              label={`Até dezembro (${resultado.mesesAteDezembro} ${resultado.mesesAteDezembro === 1 ? "mês" : "meses"})`}
              valor={sinal(resultado.deltaAteDezembro)}
              nota={`a partir de ${MESES[mesVigencia - 1]}`}
            />
            <Stat label="Em 12 meses" valor={sinal(resultado.deltaDozeMeses)} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quem muda</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {resultado.afetados.length === 0 ? (
                <p className="text-sm text-ink-muted">Nenhum salário muda com este cenário.</p>
              ) : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-ink-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Pessoa</th>
                      <th className="py-2 pr-3 text-right font-medium">Salário hoje</th>
                      <th className="py-2 pr-3 text-right font-medium">Salário simulado</th>
                      <th className="py-2 pr-3 text-right font-medium">Custo hoje</th>
                      <th className="py-2 pr-3 text-right font-medium">Custo simulado</th>
                      <th className="py-2 text-right font-medium">Diferença/mês</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.afetados.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3 text-ink-primary">
                          {p.nome}
                          {p.contratacao && <span className="ml-2 rounded bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">nova</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{p.contratacao ? "—" : formatBRL(p.salarioAtual)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(p.salarioSimulado)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{p.contratacao ? "—" : formatBRL(p.custoAtual)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(p.custoSimulado)}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{sinal(p.custoSimulado - p.custoAtual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-ink-muted">
                Custo = mês equivalente (competência): salário + encargos + 1/12 de 13º + 1/36 de terço de férias, os dois com
                encargos. “Até dezembro” multiplica a diferença mensal pelos meses restantes do ano, contando o da vigência.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ItemEditor({
  item,
  pessoas,
  departamentos,
  tabela,
  atualizar,
}: {
  item: DpItemCenario;
  pessoas: DpPessoaSim[];
  departamentos: string[];
  tabela: DpLinhaSalarial[];
  atualizar: (patch: Partial<DpItemCenario>) => void;
}) {
  if (item.tipo === "aumento") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-ink-muted" />
          <span>Aumento de</span>
          <PercentInput value={item.percentual} onChange={(v) => atualizar({ percentual: v })} />
          <span>para</span>
          <select
            value={item.alvo}
            onChange={(e) => atualizar({ alvo: e.target.value as "todos" | "departamento" | "pessoas" })}
            className={inputCls}
          >
            <option value="todos">todos da empresa</option>
            <option value="departamento">um departamento</option>
            <option value="pessoas">pessoas escolhidas</option>
          </select>
          {item.alvo === "departamento" && (
            <select value={item.departamento ?? ""} onChange={(e) => atualizar({ departamento: e.target.value })} className={inputCls}>
              <option value="">— escolha —</option>
              {departamentos.map((d) => (
                <option key={d || "_"} value={d}>
                  {d || "Sem departamento"}
                </option>
              ))}
            </select>
          )}
        </div>
        {item.alvo === "pessoas" && (
          <EscolherPessoas pessoas={pessoas} selecionadas={item.pessoas ?? []} onChange={(ids) => atualizar({ pessoas: ids })} />
        )}
      </div>
    );
  }

  if (item.tipo === "promocao") {
    const pessoa = pessoas.find((p) => p.id === item.pessoaId);
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ArrowUpRight className="h-4 w-4 text-ink-muted" />
        <span>Promover</span>
        <select
          value={item.pessoaId}
          onChange={(e) => {
            const p = pessoas.find((x) => x.id === e.target.value);
            atualizar({ pessoaId: e.target.value, novoSalario: p?.salario ?? 0 });
          }}
          className={`${inputCls} max-w-xs`}
        >
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome} ({formatBRL(p.salario ?? 0)})
            </option>
          ))}
        </select>
        <span>para</span>
        <DestinoSalario key={item.pessoaId} tabela={tabela} salario={item.novoSalario} onChange={(salario, rotulo) => atualizar({ novoSalario: salario, rotulo })} />
        {pessoa && vinculoDeCusto(pessoa.tipoContrato).vinculo !== "clt" && (
          <span className="text-xs text-ink-muted">({pessoa.tipoContrato} — sem encargos)</span>
        )}
      </div>
    );
  }

  if (item.tipo === "contratacao") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <UserPlus className="h-4 w-4 text-ink-muted" />
        <span>Contratar</span>
        <input
          type="number"
          min={1}
          max={500}
          value={item.quantidade}
          onChange={(e) => atualizar({ quantidade: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
          className={`${inputCls} w-16 text-right`}
          aria-label="Quantidade"
        />
        <span>×</span>
        <DestinoSalario
          tabela={tabela}
          salario={item.salario}
          onChange={(salario, rotulo) => atualizar({ salario, rotulo: rotulo ?? "Contratação" })}
        />
        <select value={item.vinculo} onChange={(e) => atualizar({ vinculo: e.target.value as DpVinculoCusto })} className={inputCls}>
          <option value="clt">CLT</option>
          <option value="sem_encargos">Sem encargos (PJ / estágio)</option>
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Scale className="h-4 w-4 text-ink-muted" />
      <span>
        Levar ao salário da tabela quem está abaixo dela. Quem está acima não muda; quem não tem linha da tabela vinculada fica de
        fora.
      </span>
    </div>
  );
}

/** Salário de destino: uma linha da tabela salarial ou um valor digitado. */
function DestinoSalario({
  tabela,
  salario,
  onChange,
}: {
  tabela: DpLinhaSalarial[];
  salario: number;
  onChange: (salario: number, rotulo?: string) => void;
}) {
  const linhaAtual = tabela.find((l) => Math.abs(l.salario - salario) < 0.005);
  const [texto, setTexto] = useState(salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {tabela.length > 0 && (
        <select
          value={linhaAtual?.id ?? ""}
          onChange={(e) => {
            const l = tabela.find((x) => x.id === e.target.value);
            if (!l) return;
            setTexto(l.salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
            onChange(l.salario, rotuloLinha(l));
          }}
          className={`${inputCls} max-w-xs`}
          aria-label="Linha da tabela"
        >
          <option value="">— linha da tabela —</option>
          {tabela.map((l) => (
            <option key={l.id} value={l.id}>
              {rotuloLinha(l)} ({formatBRL(l.salario)})
            </option>
          ))}
        </select>
      )}
      <span className="inline-flex items-center gap-1">
        <Briefcase className="h-3.5 w-3.5 text-ink-muted" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            const v = lerSalario(texto);
            if (v !== null && v >= 0) onChange(v);
            else setTexto(salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
          }}
          inputMode="decimal"
          className={`${inputCls} w-28 text-right tabular-nums`}
          aria-label="Salário"
        />
      </span>
    </span>
  );
}

function PercentInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [texto, setTexto] = useState(value.toLocaleString("pt-BR"));
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          const n = Number(texto.replace(",", ".").replace("%", "").trim());
          // Sempre >= 0, mesma regra do reajuste da tabela.
          if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(n);
          else setTexto(value.toLocaleString("pt-BR"));
        }}
        inputMode="decimal"
        className={`${inputCls} w-16 text-right`}
        aria-label="Percentual"
      />
      <span>%</span>
    </span>
  );
}

function EscolherPessoas({ pessoas, selecionadas, onChange }: { pessoas: DpPessoaSim[]; selecionadas: string[]; onChange: (ids: string[]) => void }) {
  const [busca, setBusca] = useState("");
  const sel = new Set(selecionadas);
  const q = busca.trim().toLowerCase();
  const visiveis = q ? pessoas.filter((p) => `${p.nome} ${p.departamento ?? ""}`.toLowerCase().includes(q)) : pessoas;
  const alternar = (id: string) => onChange(sel.has(id) ? selecionadas.filter((x) => x !== id) : [...selecionadas, id]);
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa ou departamento" className={`${inputCls} flex-1`} />
        <span className="text-xs text-ink-muted">{selecionadas.length} escolhida(s)</span>
      </div>
      <ul className="max-h-48 overflow-y-auto p-1 text-sm">
        {visiveis.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-surface-2">
              <input type="checkbox" checked={sel.has(p.id)} onChange={() => alternar(p.id)} />
              <span className="text-ink-primary">{p.nome}</span>
              <span className="text-xs text-ink-muted">{p.departamento ?? ""}</span>
              <span className="ml-auto tabular-nums text-xs text-ink-muted">{formatBRL(p.salario ?? 0)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, valor, nota, destaque }: { label: string; valor: string; nota?: string; destaque?: boolean }) {
  return (
    <Card className={destaque ? "border-sky-500/40" : undefined}>
      <CardContent className="py-4">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink-primary">{valor}</p>
        {nota && <p className="mt-0.5 text-xs text-ink-muted">{nota}</p>}
      </CardContent>
    </Card>
  );
}
