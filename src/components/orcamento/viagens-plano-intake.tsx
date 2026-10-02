"use client";

import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";

import { interpretarPlanoViagens } from "@/lib/orcamento/actions/viagens-plano";
import type { LinhaResolvida } from "@/lib/viagens/plano";
import { BotaoDitado } from "@/components/orcamento/botao-ditado";
import { Button } from "@/components/ui/button";

/**
 * RECEBER O PLANO DO ANO — o intake em lote.
 *
 * ── Por que a IA entra aqui, e não cotando ────────────────────────────────
 * O gestor tem ~50 viagens na cabeça e destinos que quase não se repetem. O que
 * custa o dia dele não é o preço — é digitar cinquenta vezes. Então ele dita ou
 * cola o plano como o tem, e a grade vem preenchida para conferir.
 *
 * ── Nada é gravado aqui ───────────────────────────────────────────────────
 * As linhas entram na grade como rascunho; gravar continua sendo "Salvar e
 * calcular", onde o motor calcula o custo e as travas valem. Leitura é SUGESTÃO.
 *
 * ── Os avisos são o produto, tanto quanto as linhas ───────────────────────
 * Faixa que não casou, mês que ninguém disse, duas cidades na mesma ida: tudo
 * isso vira frase à vista. Uma leitura que "deu certo" escondendo o que não
 * entendeu é o pior resultado possível — o gestor conferiria 50 linhas sem saber
 * quais olhar.
 */
export function ViagensPlanoIntake({
  companyId,
  year,
  setorId,
  origem,
  cidadesConhecidas,
  disabled,
  onLinhas,
}: {
  companyId: string;
  year: number;
  setorId: string | null;
  /** Cidade de partida do cabeçalho da grade — a IA precisa dela para não confundir com destino. */
  origem: string;
  /** Vocabulário do ditado: nome próprio é exatamente para o que ele serve. */
  cidadesConhecidas: readonly string[];
  disabled?: boolean;
  onLinhas: (linhas: LinhaResolvida[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [resultado, setResultado] = useState<string | null>(null);

  async function interpretar() {
    setLendo(true);
    setErro(null);
    setAvisos([]);
    setResultado(null);
    const res = await interpretarPlanoViagens(companyId, year, setorId, texto, origem);
    setLendo(false);
    if (res.needsMigration) {
      setErro("A tabela das faixas ainda não existe neste banco. Aplique a migration e recarregue.");
      return;
    }
    if (res.error) {
      setErro(res.error);
      return;
    }
    const linhas = res.linhas ?? [];
    onLinhas(linhas);
    setAvisos(res.avisos ?? []);
    setResultado(
      `${linhas.length} ${linhas.length === 1 ? "viagem entrou" : "viagens entraram"} na grade. ` +
        "Confira e clique em Salvar e calcular.",
    );
    // O texto fica: reler o mesmo plano duplicaria as linhas, e apagá-lo
    // impediria o gestor de corrigir uma frase e reler só ela.
  }

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAberto(true)}
        disabled={disabled}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Receber o plano do ano
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Receber o plano do ano</p>
          <p className="text-xs text-muted-foreground">
            Escreva ou dite as viagens como você as tem — cidade, mês, noites e quantas pessoas. A
            IA preenche a grade; nada é gravado até você clicar em Salvar e calcular.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        disabled={lendo || disabled}
        rows={6}
        placeholder={
          "Ex.: Curitiba em março, 2 noites, 3 pessoas, consultoria.\n" +
          "Recife em maio, 3 noites, 2 pessoas.\n" +
          "Duas idas a São Paulo, uma em julho e outra em outubro, bate-volta, 4 pessoas."
        }
        className="w-full rounded-md border bg-background p-3 text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <BotaoDitado
          companyId={companyId}
          categoria="plano de viagens do ano"
          grupos={cidadesConhecidas}
          disabled={lendo || disabled}
          onTexto={(t) => setTexto((atual) => (atual ? `${atual}\n${t}` : t))}
          onErro={(m) => setErro(m)}
        />
        <Button type="button" size="sm" onClick={() => void interpretar()} disabled={lendo || disabled}>
          {lendo ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Lendo o plano…
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              Preencher a grade
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          As linhas são acrescentadas às que já estão na grade.
        </span>
      </div>

      {erro && <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>}
      {resultado && <p className="text-xs text-emerald-700 dark:text-emerald-400">{resultado}</p>}
      {avisos.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-semibold">Confira nas linhas:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
