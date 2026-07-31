"use client";

import { useRef, useState } from "react";
import { Download, FileUp, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface Resultado {
  ano?: number;
  linhasLidas?: number;
  linhasAplicadas?: number;
  empresasAfetadas?: number;
  setoresCriados?: string[];
  setoresFaltando?: string[];
  cargosCriados?: number;
  cargosReativados?: number;
  niveisCriados?: number;
  niveisAtualizados?: number;
  niveisInalterados?: number;
  problemas?: string[];
  error?: string;
}

/**
 * Upload da planilha do Plano de Cargos. Como a planilha traz a empresa em cada
 * linha, um arquivo só atende todas as empresas e setores — por isso o botão
 * não depende da empresa selecionada na tela. O ANO, sim, é o da tela.
 */
export function PlanoCargosUpload({
  year,
  onImported,
}: {
  year: number;
  onImported: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [criarSetores, setCriarSetores] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviar(file: File) {
    setEnviando(true);
    setResultado(null);

    const form = new FormData();
    form.append("file", file);
    form.append("year", String(year));
    form.append("criarSetores", String(criarSetores));

    try {
      const resposta = await fetch("/api/orcamento/plano-cargos/import", {
        method: "POST",
        body: form,
      });
      const corpo = (await resposta.json()) as Resultado;
      setResultado(corpo);
      if (resposta.ok && !corpo.error) onImported();
    } catch {
      setResultado({ error: "Falha ao enviar o arquivo." });
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <FileUp className="h-4 w-4" />
        Importar planilha
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Importar plano de cargos de {year}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Colunas: <strong>Empresa · Setor · Cargo · Nível · Salário base</strong> — uma linha por
            nível. Como a empresa vem na planilha, um arquivo só atende todas de uma vez.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setResultado(null);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        A importação <strong>soma ao plano</strong>: cargos e níveis que já existem têm o salário
        atualizado, e nada é apagado. Cargos que saíram do plano precisam ser inativados na tela.
        Empresas que orçam por setor exigem a coluna Setor preenchida.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={criarSetores}
            onChange={(e) => setCriarSetores(e.target.checked)}
            disabled={enviando}
            className="h-3.5 w-3.5 accent-emerald-600"
          />
          Criar setores que ainda não existirem em {year}
        </label>

        <a
          href="/api/orcamento/plano-cargos/template"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Download className="h-3.5 w-3.5" />
          Baixar modelo
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={enviando}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void enviar(file);
          }}
          className="block text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent disabled:opacity-50"
        />
        {enviando && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Importando…
          </span>
        )}
      </div>

      {resultado && <ResultadoImport resultado={resultado} />}
    </div>
  );
}

function ResultadoImport({ resultado }: { resultado: Resultado }) {
  const problemas = resultado.problemas ?? [];
  const setoresCriados = resultado.setoresCriados ?? [];

  if (resultado.error) {
    return (
      <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">{resultado.error}</p>
        {problemas.length > 0 && <ListaProblemas itens={problemas} />}
      </div>
    );
  }

  const linhas: string[] = [
    `${resultado.linhasAplicadas ?? 0} de ${resultado.linhasLidas ?? 0} linha(s) aplicada(s) em ${resultado.empresasAfetadas ?? 0} empresa(s).`,
    `Cargos: ${resultado.cargosCriados ?? 0} criado(s)${(resultado.cargosReativados ?? 0) > 0 ? `, ${resultado.cargosReativados} reativado(s)` : ""}.`,
    `Níveis: ${resultado.niveisCriados ?? 0} criado(s), ${resultado.niveisAtualizados ?? 0} com salário atualizado, ${resultado.niveisInalterados ?? 0} sem mudança.`,
  ];
  if (setoresCriados.length > 0) {
    linhas.push(`Setores criados: ${setoresCriados.join(", ")}.`);
  }

  return (
    <div
      className={cn(
        "space-y-1 rounded-md border p-3 text-sm",
        problemas.length > 0
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-emerald-500/40 bg-emerald-500/5",
      )}
    >
      {linhas.map((linha, idx) => (
        <p key={idx} className={idx === 0 ? "font-medium" : "text-muted-foreground"}>
          {linha}
        </p>
      ))}
      {problemas.length > 0 && <ListaProblemas itens={problemas} />}
    </div>
  );
}

function ListaProblemas({ itens }: { itens: string[] }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs font-medium text-amber-700">
        {itens.length} linha(s) não aplicada(s) — ver detalhes
      </summary>
      <ul className="mt-1 max-h-48 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
        {itens.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
