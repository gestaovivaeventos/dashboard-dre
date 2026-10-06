"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";

import {
  getReferenciasViagem,
  removerReferenciaViagem,
  salvarReferenciaViagem,
  type ReferenciaSetup,
} from "@/lib/orcamento/actions/viagens-referencia";
import { formatBRL } from "@/lib/orcamento/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * DESTINOS SEM HISTÓRICO — o que a Controladoria informa.
 *
 * ── A regra que esta tela serve ───────────────────────────────────────────
 * Viagem a destino novo não é bloqueada: ela é cadastrada, fica em zero com a
 * pendência à vista na grade, e os valores vêm depois — aqui. Por isso a tela começa
 * pela FILA: os destinos que já estão em viagens de {year} e não têm número.
 *
 * ── Duas unidades, digitadas direto ──────────────────────────────────────
 * Passagem por pessoa (só ida — o motor cobra a volta como segundo trecho) e diária
 * por quarto. Não há pessoas nem noites a informar: isso vem da viagem.
 *
 * ── O reajuste NÃO se aplica a estes números ─────────────────────────────
 * O percentual por grupo corrige um valor de 2026 para o ano do orçamento. Estes já
 * são do ano do orçamento, digitados agora.
 */

const MODAIS = [
  { valor: "", label: "—" },
  { valor: "aviao", label: "Avião" },
  { valor: "onibus", label: "Ônibus" },
];

interface Rascunho {
  passagem: string;
  diaria: string;
  modal: string;
  observacao: string;
}

const VAZIO: Rascunho = { passagem: "", diaria: "", modal: "", observacao: "" };

function paraNumero(v: string): number | null {
  const t = v.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function ViagemReferenciaManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [setup, setSetup] = useState<ReferenciaSetup | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const [novo, setNovo] = useState<Rascunho & { cidade: string }>({ ...VAZIO, cidade: "" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getReferenciasViagem(companyId, year);
    if (res.error) setErro(res.error);
    setSetup(res);
    setRascunhos({});
    setCarregando(false);
  }, [companyId, year]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const isAdmin = setup?.isAdmin ?? false;
  const pendentes = setup?.pendentes ?? [];
  const informadas = setup?.informadas ?? [];

  function rascunho(chave: string): Rascunho {
    return rascunhos[chave] ?? VAZIO;
  }

  function mexer(chave: string, patch: Partial<Rascunho>) {
    setRascunhos((r) => ({ ...r, [chave]: { ...rascunho(chave), ...patch } }));
  }

  /**
   * `dados` é explícito de propósito: no bloco "por antecipação" o rascunho acabou
   * de ser digitado e o estado do React ainda não refletiu a mudança no mesmo tick —
   * ler do estado ali gravaria a linha em branco.
   */
  async function gravar(cidade: string, chave: string, dados?: Rascunho) {
    const r = dados ?? rascunho(chave);
    setOcupado(chave);
    setErro(null);
    setAviso(null);
    const res = await salvarReferenciaViagem(companyId, year, {
      cidade,
      passagemPorPessoa: paraNumero(r.passagem),
      diariaPorQuarto: paraNumero(r.diaria),
      modal: r.modal || null,
      observacao: r.observacao || null,
    });
    setOcupado(null);
    if (res.needsMigration) {
      setErro("Falta aplicar a migration 20261002160000_orcamento_viagem_referencia.sql.");
      return;
    }
    if (res.error) {
      setErro(res.error);
      return;
    }
    setAviso(
      `${cidade} informado. As viagens para lá passam a ter custo no próximo "Salvar e calcular" da grade.`,
    );
    if (chave === "__novo__") setNovo({ ...VAZIO, cidade: "" });
    void carregar();
  }

  if (carregando && !setup) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-semibold">Destino sem histórico não trava o cadastro da viagem.</p>
        <p className="mt-1 text-muted-foreground">
          Quem orça cadastra a viagem normalmente; a linha fica marcada como{" "}
          <strong>sem dados</strong> e aparece aqui. Você informa a passagem por pessoa e a diária
          por quarto, e o custo passa a existir — <strong>o sistema não estima por trás</strong>.
          Estes valores já são do ano de {year}, então o reajuste do histórico não se aplica a eles.
        </p>
      </div>

      {erro && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{aviso}</p>
      )}

      {/* ── A FILA: o que as viagens de {year} estão pedindo ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {pendentes.length > 0 && (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          )}
          <p className="text-sm font-semibold">
            {pendentes.length === 0
              ? "Nenhum destino pendente"
              : pendentes.length === 1
                ? "1 destino esperando valores"
                : `${pendentes.length} destinos esperando valores`}
          </p>
        </div>
        {pendentes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Todas as viagens de {year} têm de onde tirar o custo — por histórico ou por valor
            informado aqui.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Destino</th>
                  <th className="px-3 py-2 text-right font-medium">Viagens</th>
                  <th className="px-3 py-2 text-left font-medium">Falta</th>
                  <th className="px-3 py-2 text-right font-medium">Passagem / pessoa (ida)</th>
                  <th className="px-3 py-2 text-right font-medium">Diária / quarto</th>
                  <th className="px-3 py-2 text-left font-medium">Modal</th>
                  <th className="px-3 py-2 text-left font-medium">Fonte do valor</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pendentes.map((p) => {
                  const r = rascunho(p.cidadeChave);
                  return (
                    <tr key={p.cidadeChave} className="border-t">
                      <td className="px-3 py-2 font-medium">{p.cidade}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {p.viagens}
                      </td>
                      <td className="px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                        {p.faltaPassagem && p.faltaHospedagem
                          ? "passagem e diária"
                          : p.faltaPassagem
                            ? "passagem"
                            : "diária"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          value={r.passagem}
                          disabled={!isAdmin || !p.faltaPassagem || ocupado === p.cidadeChave}
                          onChange={(e) => mexer(p.cidadeChave, { passagem: e.target.value })}
                          placeholder={p.faltaPassagem ? "0,00" : "já tem"}
                          className="h-8 w-24 text-right"
                          inputMode="decimal"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          value={r.diaria}
                          disabled={!isAdmin || !p.faltaHospedagem || ocupado === p.cidadeChave}
                          onChange={(e) => mexer(p.cidadeChave, { diaria: e.target.value })}
                          placeholder={p.faltaHospedagem ? "0,00" : "já tem"}
                          className="h-8 w-24 text-right"
                          inputMode="decimal"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={r.modal}
                          disabled={!isAdmin || ocupado === p.cidadeChave}
                          onChange={(e) => mexer(p.cidadeChave, { modal: e.target.value })}
                          className="h-8 rounded-md border bg-background px-1 text-sm disabled:opacity-50"
                        >
                          {MODAIS.map((m) => (
                            <option key={m.valor} value={m.valor}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={r.observacao}
                          disabled={!isAdmin || ocupado === p.cidadeChave}
                          onChange={(e) => mexer(p.cidadeChave, { observacao: e.target.value })}
                          placeholder="cotação CVC, site da Latam…"
                          className="h-8 min-w-[12rem]"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isAdmin && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              ocupado === p.cidadeChave ||
                              (paraNumero(r.passagem) == null && paraNumero(r.diaria) == null)
                            }
                            onClick={() => void gravar(p.cidade, p.cidadeChave)}
                          >
                            {ocupado === p.cidadeChave ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── O que já foi informado ── */}
      {informadas.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Valores informados para {year}</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Destino</th>
                  <th className="px-3 py-2 text-right font-medium">Passagem / pessoa</th>
                  <th className="px-3 py-2 text-right font-medium">Diária / quarto</th>
                  <th className="px-3 py-2 text-left font-medium">Modal</th>
                  <th className="px-3 py-2 text-left font-medium">Fonte</th>
                  {isAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {informadas.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="px-3 py-2">{i.cidade}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {i.passagemPorPessoa == null ? "—" : formatBRL(i.passagemPorPessoa)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {i.diariaPorQuarto == null ? "—" : formatBRL(i.diariaPorQuarto)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i.modal ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {i.observacao ?? "—"}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={ocupado === i.id}
                          onClick={async () => {
                            if (!window.confirm(`Remover o valor informado de ${i.cidade}?`)) return;
                            setOcupado(i.id);
                            const res = await removerReferenciaViagem(companyId, i.id);
                            setOcupado(null);
                            if (res.error) setErro(res.error);
                            void carregar();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            O <strong>histórico vence</strong> o valor informado: se o destino passar a ter viagem
            realizada, a referência observada é usada e a linha daqui fica de reserva.
          </p>
        </div>
      )}

      {/* ── Informar um destino que ainda não está em viagem nenhuma ── */}
      {isAdmin && (
        <div className="space-y-2 rounded-lg border border-dashed p-4">
          <p className="text-sm font-semibold">Informar um destino por antecipação</p>
          <p className="text-xs text-muted-foreground">
            Dá para preencher antes de alguém cadastrar a viagem — a fila acima só mostra o que já
            foi pedido.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Cidade</label>
              <Input
                value={novo.cidade}
                onChange={(e) => setNovo((n) => ({ ...n, cidade: e.target.value }))}
                placeholder="Belém"
                className="h-9 w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Passagem / pessoa (ida)</label>
              <Input
                value={novo.passagem}
                onChange={(e) => setNovo((n) => ({ ...n, passagem: e.target.value }))}
                placeholder="0,00"
                className="h-9 w-28 text-right"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Diária / quarto</label>
              <Input
                value={novo.diaria}
                onChange={(e) => setNovo((n) => ({ ...n, diaria: e.target.value }))}
                placeholder="0,00"
                className="h-9 w-28 text-right"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Fonte</label>
              <Input
                value={novo.observacao}
                onChange={(e) => setNovo((n) => ({ ...n, observacao: e.target.value }))}
                placeholder="cotação CVC 02/10"
                className="h-9 min-w-[14rem]"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={
                ocupado === "__novo__" ||
                !novo.cidade.trim() ||
                (paraNumero(novo.passagem) == null && paraNumero(novo.diaria) == null)
              }
              onClick={() => void gravar(novo.cidade.trim(), "__novo__", novo)}
            >
              {ocupado === "__novo__" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Informar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
