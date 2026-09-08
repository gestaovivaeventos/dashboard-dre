"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Loader2 } from "lucide-react";

import {
  moverLinhaDeSetor,
  removerLinhaDoSetor,
  type MetodoComSetor,
} from "@/lib/orcamento/actions/mover-setor";
import type { OrcamentoSetor } from "@/lib/orcamento/actions/setores";
import { cn } from "@/lib/utils";

/**
 * Move uma linha de orçamento para outro setor (admin).
 *
 * Serve para dois momentos: esvaziar o "Não atribuído" que a migração por setor
 * criou, e corrigir o setor de uma despesa que o departamento do lançamento
 * classificou errado. Move a DESPESA, nunca a categoria — a categoria só é
 * atribuída ao destino para a linha não pousar num setor que não a lista.
 */
export function MoverSetorButton({
  companyId,
  year,
  metodo,
  categoryCode,
  origemSetorId,
  setores,
  linhaId,
  onMoved,
  onError,
}: {
  companyId: string;
  year: number;
  metodo: MetodoComSetor;
  categoryCode: string;
  origemSetorId: string | null;
  /** Setores ativos da empresa/ano (o de origem é filtrado fora). */
  setores: OrcamentoSetor[];
  /** Só no valor fixo, que tem N contratos por categoria. */
  linhaId?: string;
  onMoved: () => void;
  onError: (msg: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [movendo, setMovendo] = useState(false);
  // A tabela dos métodos vive dentro de um `overflow-x-auto`, que RECORTA
  // qualquer filho absoluto. Por isso o menu é renderizado num portal, com
  // posição fixa medida a partir do botão — assim ele escapa do recorte e
  // mostra o nome inteiro do setor.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function abrir() {
    const r = botaoRef.current?.getBoundingClientRect();
    if (r)
      setPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    setAberto(true);
  }

  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (caixaRef.current?.contains(alvo) || menuRef.current?.contains(alvo))
        return;
      setAberto(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    // O menu é fixo: rolar a página o deixaria para trás.
    const fechar = () => setAberto(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const destinos = setores.filter((s) => s.id !== origemSetorId);
  // Com um setor só ainda faz sentido: dá para TIRAR a categoria dele.
  if (destinos.length === 0 && !origemSetorId) return null;

  /** Tira a categoria DESTE setor (apaga a linha daqui). É a saída para o
   * resíduo da migração, quando a mesma categoria ficou em dois setores. */
  async function remover() {
    if (!origemSetorId) return;
    if (
      !window.confirm(
        "Remover esta categoria deste setor? O valor orçado dela AQUI será apagado (os outros setores não são afetados).",
      )
    ) {
      return;
    }
    setAberto(false);
    setMovendo(true);
    const res = await removerLinhaDoSetor({
      companyId,
      year,
      metodo,
      categoryCode,
      setorId: origemSetorId,
    });
    setMovendo(false);
    if (res?.error) {
      onError(res.error);
      return;
    }
    onMoved();
  }

  async function mover(destinoSetorId: string) {
    setAberto(false);
    setMovendo(true);
    const res = await moverLinhaDeSetor({
      companyId,
      year,
      metodo,
      categoryCode,
      origemSetorId,
      destinoSetorId,
      linhaId,
    });
    setMovendo(false);
    if (res?.error) {
      onError(res.error);
      return;
    }
    onMoved();
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        ref={botaoRef}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        disabled={movendo}
        title="Mover esta despesa para outro setor"
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
        )}
      >
        {movendo ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowRightLeft className="h-3.5 w-3.5" />
        )}
        Mover
      </button>

      {aberto &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 max-h-72 min-w-[14rem] max-w-[22rem] overflow-auto rounded-md border bg-popover p-1 shadow-lg"
          >
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Mover para
            </p>
            {destinos.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void mover(s.id)}
                title={s.name}
                className="block w-full break-words rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                {s.name}
              </button>
            ))}
            {origemSetorId && (
              <>
                <div className="my-1 border-t" />
                <button
                  type="button"
                  onClick={() => void remover()}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                >
                  Tirar deste setor
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
