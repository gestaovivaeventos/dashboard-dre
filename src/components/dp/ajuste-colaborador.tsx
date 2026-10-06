"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RotateCcw } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { salvarAjusteColaborador } from "@/lib/dp/actions-cadastro";
import { formatBRL } from "@/lib/orcamento/format";

interface Opcao {
  id: string;
  rotulo: string;
}

/**
 * "Plano de cargos e centro de custo" na ficha. Mostra o que VALE e de onde
 * vem (regra do cargo / padrão da linha × exceção manual) e permite criar ou
 * desfazer a exceção — sempre com motivo.
 */
export function DpAjusteColaborador(props: {
  colaboradorId: string;
  temEmpresa: boolean;
  linhas: Array<Opcao & { salario: number }>;
  centros: Opcao[];
  linhaDoCargoId: string | null;
  centroDaLinhaId: string | null;
  excecaoLinhaId: string | null;
  excecaoLinhaMotivo: string | null;
  excecaoCentroId: string | null;
  excecaoCentroMotivo: string | null;
}) {
  const [editando, setEditando] = useState(false);
  const [linhaId, setLinhaId] = useState(props.excecaoLinhaId ?? "");
  const [linhaMotivo, setLinhaMotivo] = useState(props.excecaoLinhaMotivo ?? "");
  const [centroId, setCentroId] = useState(props.excecaoCentroId ?? "");
  const [centroMotivo, setCentroMotivo] = useState(props.excecaoCentroMotivo ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const rotLinha = (id: string | null) => {
    const l = props.linhas.find((x) => x.id === id);
    return l ? `${l.rotulo} (${formatBRL(l.salario)})` : null;
  };
  const rotCentro = (id: string | null) => props.centros.find((x) => x.id === id)?.rotulo ?? null;

  const gravar = (patch?: { linhaId: string | null; centroId: string | null }) =>
    start(async () => {
      const res = await salvarAjusteColaborador({
        colaboradorId: props.colaboradorId,
        linhaId: patch ? patch.linhaId : linhaId || null,
        linhaMotivo,
        centroId: patch ? patch.centroId : centroId || null,
        centroMotivo,
      });
      if (!res.ok) {
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Vínculo atualizado", variant: "success" });
      setEditando(false);
      router.refresh();
    });

  const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
  const linhaVale = props.excecaoLinhaId ?? props.linhaDoCargoId;
  // O centro automático é o padrão da linha que VALE para a pessoa.
  const centroVale = props.excecaoCentroId ?? props.centroDaLinhaId;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Plano de cargos e centro de custo</CardTitle>
          {props.temEmpresa && !editando && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
            >
              <Pencil className="h-3.5 w-3.5" /> Criar exceção
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!props.temEmpresa ? (
          <p className="text-ink-muted">Defina a empresa desta pessoa no de-para de empresas para vinculá-la à tabela salarial.</p>
        ) : !editando ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-ink-muted">Linha da tabela</dt>
            <dd className="text-ink-primary">
              {rotLinha(linhaVale) ?? "—"}
              <Origem
                excecao={Boolean(props.excecaoLinhaId)}
                motivo={props.excecaoLinhaMotivo}
                automatico={props.excecaoLinhaId ? rotLinha(props.linhaDoCargoId) : null}
                semAuto="pela regra do cargo"
                vazio={!linhaVale}
                vazioTexto="cargo da Sólides sem linha na tabela"
              />
            </dd>
            <dt className="text-ink-muted">Centro de custo</dt>
            <dd className="text-ink-primary">
              {rotCentro(centroVale) ?? "—"}
              <Origem
                excecao={Boolean(props.excecaoCentroId)}
                motivo={props.excecaoCentroMotivo}
                automatico={props.excecaoCentroId ? rotCentro(props.centroDaLinhaId) : null}
                semAuto="padrão da linha da tabela"
                vazio={!centroVale}
                vazioTexto="a linha da tabela não tem centro de custo padrão"
              />
            </dd>
          </dl>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-ink-muted">Linha da tabela</label>
              <select value={linhaId} onChange={(e) => setLinhaId(e.target.value)} className={inputCls} disabled={pending}>
                <option value="">Automático — {rotLinha(props.linhaDoCargoId) ?? "sem linha pelo cargo"}</option>
                {props.linhas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.rotulo} ({formatBRL(l.salario)})
                  </option>
                ))}
              </select>
              {linhaId && (
                <input
                  value={linhaMotivo}
                  onChange={(e) => setLinhaMotivo(e.target.value)}
                  placeholder="Motivo da exceção (obrigatório)"
                  className={inputCls}
                  disabled={pending}
                />
              )}
            </div>
            <div className="space-y-1">
              <label className="text-ink-muted">Centro de custo</label>
              <select value={centroId} onChange={(e) => setCentroId(e.target.value)} className={inputCls} disabled={pending}>
                <option value="">Automático — {rotCentro(props.centroDaLinhaId) ?? "sem padrão na linha"}</option>
                {props.centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
              {centroId && (
                <input
                  value={centroMotivo}
                  onChange={(e) => setCentroMotivo(e.target.value)}
                  placeholder="Motivo da exceção (obrigatório)"
                  className={inputCls}
                  disabled={pending}
                />
              )}
              {props.centros.length === 0 && <p className="text-xs text-ink-muted">Esta empresa ainda não tem centros de custo cadastrados.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => gravar()}
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Salvar
              </button>
              <button type="button" onClick={() => setEditando(false)} disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-sm">
                Cancelar
              </button>
              {(props.excecaoLinhaId || props.excecaoCentroId) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => window.confirm("Voltar ao automático e apagar as exceções desta pessoa?") && gravar({ linhaId: null, centroId: null })}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink-primary"
                >
                  <RotateCcw className="h-4 w-4" /> Voltar ao automático
                </button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Origem(props: {
  excecao: boolean;
  motivo: string | null;
  automatico: string | null;
  semAuto: string;
  vazio: boolean;
  vazioTexto: string;
}) {
  if (props.vazio) return <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">{props.vazioTexto}</span>;
  if (!props.excecao) return <span className="ml-2 text-xs text-ink-muted">{props.semAuto}</span>;
  return (
    <div className="mt-0.5 text-xs">
      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-800 dark:text-amber-300">exceção manual</span>
      {props.motivo && <span className="ml-2 text-ink-muted">“{props.motivo}”</span>}
      <div className="text-ink-muted">Automático seria: {props.automatico ?? "—"}</div>
    </div>
  );
}
