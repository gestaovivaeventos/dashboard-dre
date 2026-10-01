"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info, Loader2, Plus, Trash2 } from "lucide-react";

import {
  criarTipoViagem,
  getTiposViagem,
  removerTipoViagem,
  salvarTipoViagem,
  type TiposViagemSetup,
} from "@/lib/orcamento/actions/viagens-tipos";
import { workspaceConfigSecaoHref } from "@/lib/orcamento/workspace-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * O de-para TIPO DE VIAGEM → categoria da DRE.
 *
 * Quem cadastra a viagem escolhe um tipo ("Consultoria", "Treinamento"); esta
 * tela é onde se diz em que conta cada tipo cai. Admin-only, pelo mesmo
 * enquadramento dos parâmetros e dos encargos.
 *
 * Três avisos que esta tela precisa dar, porque são estados legítimos com
 * consequência invisível:
 *
 *  1. **tipo sem categoria** — não é oferecido no cadastro da viagem. Sem o
 *     aviso, o admin cadastra o tipo e conclui que a tela de viagens quebrou.
 *  2. **categoria fora do método Viagens** — a Prévia não lê aquela categoria por
 *     esta via, então a viagem não entraria em número nenhum.
 *  3. **viagens com o mapeamento antigo** — remapear NÃO reclassifica o que já
 *     foi orçado (não pode: a `source` da finalização inclui a categoria, e mexer
 *     nela deixaria a fatia já publicada órfã no Budget). Adotar o mapeamento
 *     novo é abrir a viagem e salvar.
 */
export function ViagemTiposManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [setup, setSetup] = useState<TiposViagemSetup | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getTiposViagem(companyId, year);
    if (res.error) setErro(res.error);
    setSetup(res);
    setCarregando(false);
  }, [companyId, year]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar() {
    if (!novoNome.trim()) {
      setErro("Dê um nome ao tipo de viagem.");
      return;
    }
    setOcupado(true);
    setErro(null);
    const res = await criarTipoViagem(companyId, year, {
      nome: novoNome.trim(),
      categoryCode: novaCategoria || null,
    });
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    setNovoNome("");
    setNovaCategoria("");
    void carregar();
  }

  async function mexer(
    tipoId: string,
    patch: { nome?: string; categoryCode?: string | null; ativo?: boolean },
  ) {
    setOcupado(true);
    setErro(null);
    const res = await salvarTipoViagem(companyId, year, tipoId, patch);
    setOcupado(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    void carregar();
  }

  async function excluir(tipoId: string, nome: string) {
    if (!window.confirm(`Excluir o tipo "${nome}"?`)) return;
    setOcupado(true);
    setErro(null);
    const res = await removerTipoViagem(companyId, year, tipoId);
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
        Carregando os tipos…
      </div>
    );
  }

  if (setup?.needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-semibold">Falta aplicar a migration dos tipos de viagem.</p>
        <p className="text-muted-foreground">
          A tabela <code>orcamento_viagem_tipos</code> ainda não existe neste banco.
        </p>
      </div>
    );
  }

  const items = setup?.items ?? [];
  const categorias = setup?.categorias ?? [];
  const semCategoria = items.filter((t) => t.ativo && !t.categoryCode);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Quem cadastra a viagem escolhe o <strong>tipo</strong>; o tipo decide a conta da DRE. Assim
        quem pede a viagem não precisa conhecer o plano de contas, e mudar o plano é mexer aqui, não
        em cada viagem.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {semCategoria.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            {semCategoria.length === 1
              ? "1 tipo sem categoria mapeada"
              : `${semCategoria.length} tipos sem categoria mapeada`}
            : {semCategoria.map((t) => t.nome).join(", ")}
          </p>
          <p className="mt-1 text-muted-foreground">
            Eles <strong>não aparecem</strong> no cadastro da viagem — uma viagem sem categoria não
            entraria em conta nenhuma da DRE.
          </p>
        </div>
      )}

      {(setup?.conflitos.length ?? 0) > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Atenção: somar viagem aqui DOBRA o valor</p>
          <p className="mt-1 text-muted-foreground">
            {setup!.conflitos.map((c) => `${c.tipo} (categoria orçada por ${c.metodo})`).join("; ")}.
            Esses métodos afirmam ser o valor <strong>inteiro</strong> da categoria — a média do
            realizado do ano anterior já contém a viagem daquele ano. Aponte o tipo para outra
            categoria, ou mude o método dela em{" "}
            <Link
              href={workspaceConfigSecaoHref(companyId, year, "categoria-metodo")}
              className="font-medium underline underline-offset-2"
            >
              Método por categoria
            </Link>
            .
          </p>
        </div>
      )}

      {(setup?.desalinhadas.length ?? 0) > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <Info className="h-4 w-4" />
            {setup!.desalinhadas.length} viagem(ns) ainda com o mapeamento anterior
          </p>
          <p className="mt-1 text-muted-foreground">
            Remapear um tipo <strong>não</strong> reclassifica o que já foi orçado — o valor já pode
            ter ido ao Budget naquela conta. Para adotar o mapeamento novo, abra a viagem e clique em
            “Salvar e calcular”. São elas:{" "}
            {setup!.desalinhadas.map((d) => d.titulo).join(", ")}.
          </p>
        </div>
      )}

      {/* ── Novo tipo ── */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label htmlFor="tipo-nome" className="text-xs">
            Novo tipo
          </Label>
          <Input
            id="tipo-nome"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Consultoria, Treinamento, Visita a cliente…"
            className="h-9"
          />
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1">
          <Label htmlFor="tipo-cat" className="text-xs">
            Categoria da DRE (opcional agora)
          </Label>
          <select
            id="tipo-cat"
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Mapear depois…</option>
            {categorias.map((c) => (
              <option key={c.categoryCode} value={c.categoryCode}>
                {c.categoryName}
                {c.metodo && c.metodo !== "viagens" ? " (outro método)" : ""}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={() => void criar()} disabled={ocupado}>
          <Plus className="mr-1.5 h-4 w-4" />
          Acrescentar
        </Button>
      </div>

      {/* ── A lista ── */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhum tipo cadastrado. Enquanto não houver um tipo mapeado, não há como orçar viagem
          nesta empresa.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-left font-medium">Categoria da DRE</th>
                <th className="px-3 py-2 text-right font-medium">Viagens</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className={cn("border-t", !t.ativo && "opacity-60")}>
                  <td className="px-3 py-2">
                    <Input
                      defaultValue={t.nome}
                      disabled={ocupado}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== t.nome) void mexer(t.id, { nome: v });
                      }}
                      className="h-8"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={t.categoryCode ?? ""}
                      disabled={ocupado}
                      onChange={(e) => void mexer(t.id, { categoryCode: e.target.value || null })}
                      className="h-8 w-full min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">— sem mapeamento —</option>
                      {categorias.map((c) => (
                        <option key={c.categoryCode} value={c.categoryCode}>
                          {c.categoryName}
                          {c.metodo && c.metodo !== "viagens" ? " (outro método)" : ""}
                        </option>
                      ))}
                    </select>
                    {t.categoryCode && t.metodoDaCategoria && (
                      <p
                        className={cn(
                          "mt-0.5 text-[11px]",
                          t.metodoDaCategoria === "media" || t.metodoDaCategoria === "valor_fixo"
                            ? "text-amber-700 dark:text-amber-500"
                            : "text-muted-foreground",
                        )}
                      >
                        {t.metodoDaCategoria === "media" || t.metodoDaCategoria === "valor_fixo"
                          ? "a categoria já é projetada por outro método — somar viagem dobra"
                          : "soma com o que o outro método já orça nesta categoria"}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.viagens}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => void mexer(t.id, { ativo: !t.ativo })}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        t.ativo
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {t.ativo ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado}
                      onClick={() => void excluir(t.id, t.nome)}
                      title={
                        t.viagens > 0
                          ? "Há viagens deste tipo — desative em vez de excluir"
                          : "Excluir o tipo"
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

      <p className="text-xs text-muted-foreground">
        Desativar um tipo para de oferecê-lo no cadastro sem apagar de que tipo as viagens antigas
        eram — é por isso que excluir é recusado quando há viagem apontando para ele.
      </p>
    </div>
  );
}
