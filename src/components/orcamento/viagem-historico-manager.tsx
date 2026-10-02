"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Trash2, Upload } from "lucide-react";

import {
  getHistoricoViagens,
  limparAnoHistorico,
  removerLinhaHistorico,
  setAnoBaseHistorico,
  setReajusteViagem,
  type HistoricoSetup,
} from "@/lib/orcamento/actions/viagens-historico";
import { GRUPO_LABEL, type GrupoViagem } from "@/lib/viagens/custo/tipos";
import { custosUnitarios, reajustar } from "@/lib/viagens/historico";
import { formatBRL } from "@/lib/orcamento/format";
import { MigrationAviso } from "@/components/orcamento/migration-aviso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * HISTÓRICO DE VIAGENS REALIZADAS — a fonte de preço do módulo.
 *
 * ── O que esta tela resolve ───────────────────────────────────────────────
 * O desenho anterior pedia ao admin o valor de ~10 faixas. Ele não tem esses
 * números na cabeça — tem a planilha do que foi gasto no ano passado, e vários
 * destinos repetem. Aqui ele sobe o que aconteceu e digita ~4 percentuais de
 * reajuste; o resto o sistema deriva.
 *
 * ── O custo unitário é DERIVADO, nunca digitado ──────────────────────────
 * A planilha traz o total pago por viagem; a tela mostra o que isso significa por
 * pessoa e por quarto. É a mesma conta que o motor usa — mostrá-la aqui é o que
 * permite ao admin conferir a referência antes de ela virar orçamento.
 *
 * ── Subir a planilha SUBSTITUI o ano ─────────────────────────────────────
 * Não dá para deduplicar: duas idas a Recife em maio com os mesmos números são
 * dois fatos. Substituir é o que torna o reenvio idempotente — e a tela diz isso
 * antes do envio, não depois.
 */

/** Os grupos que recebem reajuste, na ordem em que pesam no orçamento. */
const GRUPOS_REAJUSTE: GrupoViagem[] = [
  "passagem",
  "hospedagem",
  "alimentacao",
  "translado",
  "transporte_local",
  "outros",
];

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function ViagemHistoricoManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [setup, setSetup] = useState<HistoricoSetup | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [anoBaseEscolhido, setAnoBaseEscolhido] = useState<number | null>(null);
  const [anoUpload, setAnoUpload] = useState<string>(String(year - 1));
  const [rascunhoPct, setRascunhoPct] = useState<Partial<Record<GrupoViagem, string>>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getHistoricoViagens(companyId, year, anoBaseEscolhido);
    if (res.error) setErro(res.error);
    setSetup(res);
    setRascunhoPct({});
    setCarregando(false);
  }, [companyId, year, anoBaseEscolhido]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linhas = setup?.linhas ?? [];
  const destinos = setup?.destinos ?? [];
  const reajustes = setup?.reajustes ?? {};
  const isAdmin = setup?.isAdmin ?? false;

  /** O que a planilha deixou de fora, para a tela dizer antes de alguém perguntar. */
  const semPassagem = destinos.filter((d) => d.passagemPorPessoa == null).length;

  async function enviarPlanilha(file: File) {
    const anoBase = Number(anoUpload);
    if (!Number.isInteger(anoBase) || anoBase < 2000 || anoBase > year) {
      setErro(`Informe o ano em que as viagens aconteceram (até ${year}).`);
      return;
    }
    if (
      !window.confirm(
        `Subir esta planilha SUBSTITUI o histórico de ${anoBase} inteiro. Continuar?`,
      )
    ) {
      return;
    }
    setOcupado(true);
    setErro(null);
    setAviso(null);
    setProblemas([]);
    const form = new FormData();
    form.set("file", file);
    form.set("companyId", companyId);
    form.set("year", String(year));
    form.set("anoBase", String(anoBase));
    try {
      const res = await fetch("/api/orcamento/viagens/historico/import", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        aviso?: string;
        linhas?: number;
        destinos?: number;
        comPassagem?: number;
        comDiaria?: number;
        problemas?: string[];
      };
      setProblemas(json.problemas ?? []);
      if (!res.ok || !json.ok) {
        setErro([json.error, json.aviso].filter(Boolean).join(" "));
        return;
      }
      setAnoBaseEscolhido(anoBase);
      setAviso(
        `${json.linhas} viagem(ns) de ${anoBase} · ${json.destinos} destino(s) — ` +
          `${json.comPassagem} com preço de passagem, ${json.comDiaria} com diária.`,
      );
      await carregar();
    } catch {
      setErro("Não consegui enviar a planilha.");
    } finally {
      setOcupado(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function gravarPct(grupo: GrupoViagem, texto: string) {
    const pct = texto.trim() === "" ? 0 : Number(texto.replace(",", "."));
    if (!Number.isFinite(pct)) {
      setErro("Percentual inválido.");
      return;
    }
    setOcupado(true);
    setErro(null);
    const res = await setReajusteViagem(companyId, year, grupo, pct);
    setOcupado(false);
    if (res.needsMigration) {
      setErro("Falta aplicar a migration do histórico de viagens.");
      return;
    }
    if (res.error) {
      setErro(res.error);
      return;
    }
    void carregar();
  }

  if (carregando && !setup) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando o histórico…
      </div>
    );
  }

  if (setup?.needsMigration) {
    return (
      <MigrationAviso
        migration="20261002150000_orcamento_viagem_historico.sql"
        tabela="orcamento_viagem_historico"
      />
    );
  }

  const anoBase = setup?.anoBase ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-semibold">O custo das viagens vem daqui.</p>
        <p className="mt-1 text-muted-foreground">
          Suba o que foi gasto no ano passado e informe o reajuste por grupo de custo. Para cada
          destino que já apareceu no histórico, o orçamento usa o que{" "}
          <strong>este time pagou de fato</strong> para ir ali, reajustado — e a premissa da viagem
          diz de quantas viagens e de quais meses o número saiu. Destino novo cai na faixa de custo,
          e só o que não tem nem faixa vai para a busca na web.
        </p>
      </div>

      {/* ── Upload ── */}
      {isAdmin && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-sm font-semibold">Subir o histórico</p>
          <p className="text-xs text-muted-foreground">
            Uma linha por viagem realizada. O modelo já vem com os destinos que a empresa orça — o
            que falta é o que foi pago. Subir a planilha <strong>substitui</strong> o histórico
            daquele ano inteiro.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Ano das viagens</label>
              <Input
                value={anoUpload}
                onChange={(e) => setAnoUpload(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="h-9 w-24"
                inputMode="numeric"
              />
            </div>
            <a
              href={`/api/orcamento/viagens/historico/template?companyId=${companyId}&year=${year}&anoBase=${anoUpload}`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Baixar o modelo
            </a>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={ocupado}
              onClick={() => inputRef.current?.click()}
            >
              {ocupado ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              Enviar planilha
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void enviarPlanilha(f);
              }}
            />
          </div>
        </div>
      )}

      {erro && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{aviso}</p>
      )}
      {problemas.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">
            {problemas.length === 1 ? "1 linha não entrou" : `${problemas.length} linhas não entraram`}:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {problemas.slice(0, 20).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {problemas.length > 20 && (
            <p className="mt-1 text-muted-foreground">e mais {problemas.length - 20}…</p>
          )}
        </div>
      )}

      {/* ── Ano-base ── */}
      {(setup?.anos.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Ano-base do orçamento de {year}</label>
            <select
              value={anoBase ?? ""}
              disabled={!isAdmin || ocupado}
              onChange={async (e) => {
                const v = Number(e.target.value);
                setAnoBaseEscolhido(v);
                if (isAdmin) await setAnoBaseHistorico(companyId, year, v);
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {(setup?.anos ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <p className="flex-1 text-xs text-muted-foreground">
            {linhas.length} viagem(ns) · {destinos.length} destino(s)
            {semPassagem > 0 && (
              <>
                {" "}
                · <strong>{semPassagem}</strong> sem preço de passagem (só hotel, ou viagem de
                carro) — esses caem na faixa
              </>
            )}
          </p>
          {isAdmin && anoBase != null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ocupado}
              onClick={async () => {
                if (!window.confirm(`Apagar o histórico de ${anoBase} inteiro?`)) return;
                setOcupado(true);
                const res = await limparAnoHistorico(companyId, anoBase);
                setOcupado(false);
                if (res.error) setErro(res.error);
                else setAviso(`${res.removidas ?? 0} linha(s) removida(s).`);
                void carregar();
              }}
            >
              Apagar {anoBase}
            </Button>
          )}
        </div>
      )}

      {/* ── Reajuste por grupo de custo ── */}
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-sm font-semibold">Reajuste até {year}, por grupo de custo</p>
        <p className="text-xs text-muted-foreground">
          Tarifa aérea e diária de hotel não sobem no mesmo ritmo — por isso é um percentual por
          grupo, e não um só. O valor é <strong>acumulado do ano-base até {year}</strong>. Em branco
          ou 0 usa o histórico como está.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {GRUPOS_REAJUSTE.map((g) => {
            const atual = reajustes[g] ?? 0;
            const valor = rascunhoPct[g] ?? (atual === 0 ? "" : String(atual).replace(".", ","));
            return (
              <div key={g} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <span className="min-w-0 truncate text-xs" title={GRUPO_LABEL[g]}>
                  {GRUPO_LABEL[g]}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Input
                    value={valor}
                    disabled={!isAdmin || ocupado}
                    onChange={(e) => setRascunhoPct((r) => ({ ...r, [g]: e.target.value }))}
                    onBlur={(e) => {
                      const txt = e.target.value.trim();
                      const novo = txt === "" ? 0 : Number(txt.replace(",", "."));
                      if (Number.isFinite(novo) && novo !== atual) void gravarPct(g, txt);
                    }}
                    placeholder="0"
                    className="h-8 w-20 text-right"
                    inputMode="decimal"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── A referência que o orçamento vai usar ── */}
      {destinos.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold">O que o orçamento vai usar</p>
            <p className="text-xs text-muted-foreground">
              Mediana das viagens de cada destino, já com o reajuste. É exatamente o número que
              entra na linha da grade — e a premissa da viagem repete esta conta.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Destino</th>
                  <th className="px-3 py-2 text-right font-medium">Viagens</th>
                  <th className="px-3 py-2 text-left font-medium">Meses</th>
                  <th className="px-3 py-2 text-right font-medium">Passagem / pessoa (ida)</th>
                  <th className="px-3 py-2 text-right font-medium">Diária / quarto</th>
                </tr>
              </thead>
              <tbody>
                {destinos.map((d) => {
                  const pass =
                    d.passagemPorPessoa == null
                      ? null
                      : reajustar(d.passagemPorPessoa, reajustes.passagem ?? 0);
                  const diaria =
                    d.diariaPorQuarto == null
                      ? null
                      : reajustar(d.diariaPorQuarto, reajustes.hospedagem ?? 0);
                  return (
                    <tr key={d.cidadeChave} className="border-t">
                      <td className="px-3 py-2">{d.cidade}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {d.viagens}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {d.meses.map((m) => MES_CURTO[m - 1]).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {pass == null ? (
                          <span className="text-xs text-muted-foreground">cai na faixa</span>
                        ) : (
                          formatBRL(pass)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {diaria == null ? (
                          <span className="text-xs text-muted-foreground">cai na faixa</span>
                        ) : (
                          formatBRL(diaria)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(setup?.alimentacaoSugerida != null || setup?.transporteLocalSugerido != null) && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {setup?.alimentacaoSugerida != null && (
                <p>
                  O histórico sugere <strong>{formatBRL(setup.alimentacaoSugerida)}</strong> de
                  alimentação por pessoa por dia. Quem define esse número é você, em Parâmetros de
                  viagem — aqui é só a leitura do que foi gasto.
                </p>
              )}
              {setup?.transporteLocalSugerido != null && (
                <p>
                  E <strong>{formatBRL(setup.transporteLocalSugerido)}</strong> de transporte local
                  (uber, táxi, transfer, estacionamento) por pessoa por dia. Esse não é parâmetro de
                  empresa: o motor pede trajetos × custo por trajeto em cada viagem, então o número
                  serve de referência para quem preenche a linha — nunca é aplicado sozinho.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── As viagens lançadas ── */}
      {linhas.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            As {linhas.length} viagem(ns) de {anoBase}
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Cidade</th>
                  <th className="px-3 py-2 text-left font-medium">Mês</th>
                  <th className="px-3 py-2 text-right font-medium">Pess.</th>
                  <th className="px-3 py-2 text-right font-medium">Noites</th>
                  <th className="px-3 py-2 text-left font-medium">Modal</th>
                  <th className="px-3 py-2 text-right font-medium">Passagem</th>
                  <th className="px-3 py-2 text-right font-medium">Hotel</th>
                  <th className="px-3 py-2 text-right font-medium">Alim.</th>
                  <th className="px-3 py-2 text-right font-medium">Local</th>
                  <th className="px-3 py-2 text-right font-medium">= por pessoa (ida)</th>
                  {isAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const u = custosUnitarios(l);
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{l.cidade}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.mes ? MES_CURTO[l.mes - 1] : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.pessoas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.noites}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.modal ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.custoPassagem == null ? "—" : formatBRL(l.custoPassagem)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.custoHospedagem == null ? "—" : formatBRL(l.custoHospedagem)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.custoAlimentacao == null ? "—" : formatBRL(l.custoAlimentacao)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {l.custoTransporteLocal == null ? "—" : formatBRL(l.custoTransporteLocal)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          u.passagemPorPessoa == null && "text-muted-foreground",
                        )}
                      >
                        {u.passagemPorPessoa == null ? "—" : formatBRL(u.passagemPorPessoa)}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={ocupado}
                            onClick={async () => {
                              if (!window.confirm(`Remover a viagem para ${l.cidade}?`)) return;
                              setOcupado(true);
                              const res = await removerLinhaHistorico(companyId, l.id);
                              setOcupado(false);
                              if (res.error) setErro(res.error);
                              void carregar();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {linhas.length === 0 && !carregando && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhum histórico ainda. Baixe o modelo, preencha o que foi gasto no ano passado e suba —
          é o que faz o custo das viagens parar de ser estimativa.
        </p>
      )}
    </div>
  );
}
