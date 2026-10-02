"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";

import {
  getFaixasViagem,
  removerFaixaViagem,
  salvarFaixaViagem,
  semearFaixasViagem,
  type FaixasSetup,
  type TipoFaixa,
} from "@/lib/orcamento/actions/viagens-faixas";
import { MigrationAviso } from "@/components/orcamento/migration-aviso";
import { ViagemFaixasCalibragem } from "@/components/orcamento/viagem-faixas-calibragem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * FAIXAS de custo de viagem — a tabela de referência do admin.
 *
 * ── O que esta tela resolve ───────────────────────────────────────────────
 * ~50 viagens por ano a destinos que quase não se repetem. Cotar cada uma não
 * amortiza nada e nem é preciso (o orçamento tem só o mês, um ano à frente,
 * quando a tarifa ainda não foi publicada). Então o custo vem destas ~10 linhas,
 * revisadas uma vez por ano, e é só aqui que a pesquisa de preço trabalha.
 *
 * Ganho que não é óbvio: duas viagens ao mesmo destino passam a custar o MESMO.
 * Com cotação por viagem elas saíam diferentes só porque a busca correu em dias
 * diferentes.
 *
 * ── Valor ZERO é estado legítimo, e a tela diz o que ele causa ───────────
 * Faixa sem valor não precifica: a viagem entra zero, DITO em premissa. É melhor
 * do que um valor chutado, que pareceria referência curada — mas o admin precisa
 * saber que é isso que está acontecendo, senão conclui que a grade quebrou.
 */

const MODAIS = [
  { valor: "", label: "—" },
  { valor: "aviao", label: "Avião" },
  { valor: "onibus", label: "Ônibus" },
  { valor: "carro", label: "Carro" },
  { valor: "van", label: "Van" },
];

export function ViagemFaixasManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [setup, setSetup] = useState<FaixasSetup | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ tipo: TipoFaixa; nome: string; valor: string; modal: string }>({
    tipo: "passagem",
    nome: "",
    valor: "",
    modal: "aviao",
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getFaixasViagem(companyId, year);
    if (res.error) setErro(res.error);
    setSetup(res);
    setCarregando(false);
  }, [companyId, year]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(
    input: Parameters<typeof salvarFaixaViagem>[2],
  ): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    const res = await salvarFaixaViagem(companyId, year, input);
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return false;
    }
    void carregar();
    return true;
  }

  async function semear() {
    setOcupado(true);
    setErro(null);
    const res = await semearFaixasViagem(companyId, year);
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    void carregar();
  }

  async function excluir(id: string, nome: string) {
    if (!window.confirm(`Excluir a faixa "${nome}"?`)) return;
    setOcupado(true);
    setErro(null);
    const res = await removerFaixaViagem(companyId, year, id);
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    void carregar();
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando as faixas…
      </div>
    );
  }

  if (setup?.needsMigration) {
    return (
      <MigrationAviso
        migration="20261002140000_orcamento_viagem_faixas.sql"
        tabela="orcamento_viagem_faixas"
      />
    );
  }

  const items = setup?.items ?? [];
  const semValor = items.filter((f) => f.ativo && f.valor <= 0);

  function secao(tipo: TipoFaixa, titulo: string, ajuda: string) {
    const linhas = items.filter((f) => f.tipo === tipo);
    return (
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{ajuda}</p>
        </div>
        {linhas.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            Nenhuma faixa cadastrada.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Faixa</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {tipo === "passagem" ? "R$ por pessoa (só ida)" : "Diária por quarto"}
                  </th>
                  {tipo === "passagem" && (
                    <th className="px-3 py-2 text-left font-medium">Modal</th>
                  )}
                  <th className="px-3 py-2 text-right font-medium">Viagens</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((f) => (
                  <tr key={f.id} className={cn("border-t", !f.ativo && "opacity-60")}>
                    <td className="px-3 py-2">
                      <Input
                        defaultValue={f.nome}
                        disabled={ocupado}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== f.nome) {
                            void salvar({ id: f.id, tipo: f.tipo, nome: v, valor: f.valor, modal: f.modal });
                          }
                        }}
                        className="h-8 min-w-[14rem]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={f.valor || ""}
                        disabled={ocupado}
                        placeholder="0,00"
                        onBlur={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          if (v !== f.valor) {
                            void salvar({ id: f.id, tipo: f.tipo, nome: f.nome, valor: v, modal: f.modal });
                          }
                        }}
                        className="h-8 w-32 text-right"
                      />
                    </td>
                    {tipo === "passagem" && (
                      <td className="px-3 py-2">
                        <select
                          value={f.modal ?? ""}
                          disabled={ocupado}
                          onChange={(e) =>
                            void salvar({
                              id: f.id,
                              tipo: f.tipo,
                              nome: f.nome,
                              valor: f.valor,
                              modal: e.target.value || null,
                            })
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {MODAIS.map((m) => (
                            <option key={m.valor} value={m.valor}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">{f.viagens}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() =>
                          void salvar({
                            id: f.id,
                            tipo: f.tipo,
                            nome: f.nome,
                            valor: f.valor,
                            modal: f.modal,
                            ativo: !f.ativo,
                          })
                        }
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px] font-medium",
                          f.ativo
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {f.ativo ? "Ativa" : "Inativa"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={ocupado}
                        onClick={() => void excluir(f.id, f.nome)}
                        title={
                          f.viagens > 0
                            ? "Há viagens usando esta faixa — desative em vez de excluir"
                            : "Excluir a faixa"
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        O custo de cada viagem da grade sai destas faixas. São ~10 números, revisados uma vez por
        ano — é o que substitui cotar 50 viagens uma por uma, e o que faz duas viagens ao mesmo
        destino custarem o mesmo.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="flex-1">
            <p className="font-semibold">Comece pelas faixas padrão.</p>
            <p className="mt-1 text-muted-foreground">
              Oito faixas de passagem e três de hospedagem, cobrindo o Brasil para quem sai do
              Sudeste. Elas entram com <strong>valor zero</strong> — você preenche os dez números.
            </p>
          </div>
          <Button onClick={() => void semear()} disabled={ocupado}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Criar as faixas padrão
          </Button>
        </div>
      )}

      {semValor.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            {semValor.length === 1 ? "1 faixa sem valor" : `${semValor.length} faixas sem valor`}:{" "}
            {semValor.map((f) => f.nome).join(", ")}
          </p>
          <p className="mt-1 text-muted-foreground">
            Viagem que usar uma delas entra com <strong>custo zero</strong> — dito em premissa, nunca
            escondido. É melhor que um valor chutado, mas o orçamento fica incompleto até você
            preencher.
          </p>
        </div>
      )}

      {/* A busca na web trabalha aqui, nas ~10 faixas — não nas 50 viagens. */}
      {items.length > 0 && setup?.isAdmin && (
        <ViagemFaixasCalibragem companyId={companyId} year={year} onAplicado={() => void carregar()} />
      )}

      {secao(
        "passagem",
        "Passagem",
        "R$ por pessoa, SÓ IDA — o motor cobra o trecho de volta à parte. Em faixa de carro/van o valor é ignorado: ali o custo é km × R$/km, que vem dos parâmetros.",
      )}
      {secao(
        "hospedagem",
        "Hospedagem",
        "Diária por QUARTO. A grade calcula os quartos por ceil(pessoas ÷ pessoas por quarto).",
      )}

      {/* ── Nova faixa ── */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tipo</label>
          <select
            value={novo.tipo}
            onChange={(e) => setNovo((n) => ({ ...n, tipo: e.target.value as TipoFaixa }))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="passagem">Passagem</option>
            <option value="hospedagem">Hospedagem</option>
          </select>
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Nome da faixa</label>
          <Input
            value={novo.nome}
            onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
            placeholder="Capital Nordeste"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Valor</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={novo.valor}
            onChange={(e) => setNovo((n) => ({ ...n, valor: e.target.value }))}
            placeholder="0,00"
            className="h-9 w-32 text-right"
          />
        </div>
        {novo.tipo === "passagem" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Modal</label>
            <select
              value={novo.modal}
              onChange={(e) => setNovo((n) => ({ ...n, modal: e.target.value }))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {MODAIS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button
          size="sm"
          disabled={ocupado}
          onClick={async () => {
            const ok = await salvar({
              tipo: novo.tipo,
              nome: novo.nome,
              valor: novo.valor === "" ? 0 : Number(novo.valor),
              modal: novo.tipo === "passagem" ? novo.modal || null : null,
            });
            if (ok) setNovo((n) => ({ ...n, nome: "", valor: "" }));
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Acrescentar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Mudar uma faixa <strong>não recalcula</strong> as viagens já salvas: cada uma guarda o
        cálculo com os valores que usou. Para adotar o número novo, abra a grade e salve a linha.
      </p>
    </div>
  );
}
