"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";

import {
  getMetodosPorEmpresa,
  setMetodoVisivel,
  type MetodosPorEmpresaResult,
} from "@/lib/orcamento/actions/metodos-empresa";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Quais telas do orçamento aparecem em cada empresa.
 *
 * Uma linha por empresa, uma coluna por método: marcado = aparece. A caixa é o
 * gesto inteiro (não há botão Salvar) porque a alteração é de uma célula e
 * esperar um salvar em lote faria perder de vista qual mudou.
 *
 * **Desmarcar é que grava** — o banco guarda a lista de exclusões, então nada
 * cadastrado aqui significa "tudo aparece", e método novo nasce visível. Ver
 * `metodos-visiveis.ts`.
 *
 * Esconder um método que JÁ TEM coisa orçada é recusado pelo servidor, com o
 * número à vista: a tela esconde a porta, não o valor, e ele continuaria somando
 * na Prévia e no Budget sem caminho por onde abri-lo. A célula mostra a contagem
 * justamente para o admin ver isso antes de tentar.
 */
export function MetodosEmpresaManager() {
  const [dados, setDados] = useState<MetodosPorEmpresaResult | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await getMetodosPorEmpresa();
    if (res.error) setErro(res.error);
    setDados(res);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternar(companyId: string, metodo: string, visivel: boolean) {
    const chave = `${companyId}|${metodo}`;
    setOcupado(chave);
    setErro(null);
    const res = await setMetodoVisivel(companyId, metodo, visivel);
    setOcupado(null);
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
        Carregando as empresas…
      </div>
    );
  }

  if (dados?.needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-semibold">Falta aplicar a migration.</p>
        <p className="text-muted-foreground">
          A tabela <code>orcamento_metodos_ocultos</code> ainda não existe neste banco.
        </p>
      </div>
    );
  }

  const metodos = dados?.metodos ?? [];
  const termo = busca.trim().toLowerCase();
  const items = (dados?.items ?? []).filter(
    (e) => !termo || e.companyName.toLowerCase().includes(termo),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marque as telas que aparecem no orçamento de cada empresa. Nada marcado aqui significa que
        tudo aparece — desmarcar é que esconde. Vale para todos os anos: é cadastro da unidade, não
        do exercício.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar empresa…"
          className="h-9 pl-8"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">
                Empresa
              </th>
              {metodos.map((m) => (
                <th key={m.key} className="px-3 py-2 text-center font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const ocultos = new Set(e.ocultos);
              return (
                <tr key={e.companyId} className="border-t">
                  <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
                    {e.companyName}
                    {ocultos.size > 0 && (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {ocultos.size} escondida{ocultos.size === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  {metodos.map((m) => {
                    const visivel = !ocultos.has(m.key);
                    const quantos = e.dados[m.key] ?? 0;
                    const chave = `${e.companyId}|${m.key}`;
                    return (
                      <td key={m.key} className="px-3 py-2 text-center">
                        <label
                          className={cn(
                            "inline-flex cursor-pointer flex-col items-center gap-0.5",
                            ocupado === chave && "opacity-50",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={visivel}
                            disabled={ocupado != null}
                            onChange={() => void alternar(e.companyId, m.key, !visivel)}
                            className="h-4 w-4"
                          />
                          {/* A contagem existe para o admin ver, ANTES de tentar,
                              por que o servidor vai recusar o desmarcar. */}
                          {quantos > 0 && (
                            <span className="text-[10px] leading-none text-muted-foreground">
                              {quantos}
                            </span>
                          )}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma empresa com esse nome.</p>
      )}

      <p className="text-xs text-muted-foreground">
        O número abaixo da caixa é quanto já foi orçado por aquele método na empresa. Esconder uma
        tela com valor orçado é recusado: o valor continuaria somando na Prévia e no Budget sem
        nenhuma tela por onde abri-lo.
      </p>
    </div>
  );
}
