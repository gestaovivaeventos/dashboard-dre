"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

import { getViagensSetup, salvarParametrosViagem } from "@/lib/orcamento/actions/viagens";
import { PARAMETROS_PADRAO } from "@/lib/viagens/custo/mapear";
import type { ParametrosViagem } from "@/lib/viagens/custo/tipos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Os PARÂMETROS que ancoram a estimativa de viagem, por empresa × ano.
 *
 * É daqui que sai todo número que a IA não inventou: ela monta o roteiro, a conta
 * vem destes valores. Admin-only pelo mesmo enquadramento dos encargos e do plano
 * de cargos — quanto vale o km e a diária é premissa da empresa, não construção
 * de quem pede a viagem.
 *
 * **Mudar um parâmetro NÃO recalcula as viagens já salvas.** Cada uma guarda o
 * retrato com os parâmetros que usou, e é isso que impede o número já aprovado
 * pela diretoria (e já publicado no Budget) de mudar sozinho em novembro. Para
 * uma viagem passar a usar o valor novo, alguém precisa abri-la e salvar — ato
 * explícito, visível na tela. O aviso abaixo diz isso ao admin.
 */

interface Campo {
  chave: keyof ParametrosViagem;
  label: string;
  ajuda: string;
  passo: string;
}

const CAMPOS: readonly Campo[] = [
  {
    chave: "diariaAlimentacao",
    label: "Alimentação por dia",
    ajuda: "Por pessoa por DIA (noites + 1: o dia da volta também se come). É política da empresa, não cotação.",
    passo: "0.01",
  },
  {
    chave: "rsPorKm",
    label: "Carro próprio — R$ por km",
    ajuda: "Por VEÍCULO, não por pessoa. Inclui combustível e desgaste — aqui o km é o driver real do custo.",
    passo: "0.01",
  },
];

export function ViagemParametrosManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [valores, setValores] = useState<ParametrosViagem>(PARAMETROS_PADRAO);
  const [usandoPadrao, setUsandoPadrao] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let vivo = true;
    void getViagensSetup(companyId, year, null).then((res) => {
      if (!vivo) return;
      if (res.error) setErro(res.error);
      setValores(res.parametros);
      setUsandoPadrao(res.parametrosPadrao);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [companyId, year]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setOk(false);
    const res = await salvarParametrosViagem(companyId, year, valores);
    setSalvando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    setUsandoPadrao(false);
    setOk(true);
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando os parâmetros…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {usandoPadrao && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Esta empresa ainda não tem parâmetros para {year}.</p>
          <p className="mt-1 text-muted-foreground">
            As viagens estão sendo estimadas com os padrões do sistema, mostrados abaixo. Salve para
            fixar os valores desta empresa.
          </p>
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <div key={c.chave} className="space-y-1">
            <Label htmlFor={`param-${c.chave}`} className="text-xs">
              {c.label}
            </Label>
            <Input
              id={`param-${c.chave}`}
              type="number"
              step={c.passo}
              min="0"
              value={valores[c.chave]}
              onChange={(e) => {
                const v = e.target.value === "" ? 0 : Number(e.target.value);
                setValores((atual) => ({ ...atual, [c.chave]: v }));
                setOk(false);
              }}
              className="h-9"
            />
            <p className="text-[11px] leading-snug text-muted-foreground">{c.ajuda}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Mudar um parâmetro <strong>não recalcula</strong> as viagens já salvas: cada uma guarda o
        cálculo com os valores que usou. É isso que impede uma viagem já aprovada — e já publicada no
        Budget — de mudar de valor sozinha. Para uma viagem passar a usar o número novo, abra-a e
        clique em “Salvar e calcular”.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void salvar()} disabled={salvando}>
          {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Salvar parâmetros
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setValores(PARAMETROS_PADRAO);
            setOk(false);
          }}
          disabled={salvando}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Voltar aos padrões
        </Button>
        {ok && <span className="text-xs text-emerald-700 dark:text-emerald-400">Salvo.</span>}
      </div>
    </div>
  );
}
