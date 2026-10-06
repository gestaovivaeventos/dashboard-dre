// =============================================================================
// O PROMPT do intake do plano do ano (02/10/2026) — fase 3.
//
// ── O que esta chamada é, e o que ela NÃO é ───────────────────────────────
// Não é conversa. É UMA leitura: o gestor dita ou cola o plano de viagens do ano
// como ele o tem na cabeça — "Curitiba em março, 2 noites, 3 pessoas; Recife em
// maio, 3 noites, 2 pessoas; duas idas a São Paulo no segundo semestre…" — e a
// resposta são as linhas da grade. Mesmo padrão do pedido colado do WhatsApp do
// Case: leitura é SUGESTÃO, nada é gravado, e o gestor confere na tela.
//
// ── A IA devolve NOMES, nunca ids nem números de dinheiro ─────────────────
// Ela escolhe o tipo da LISTA que vai no prompt, copiando o nome; o casamento
// nome → id é do `plano.ts`, que avisa o que não casou. E não há campo de preço no
// schema, de propósito: desde 06/10/2026 o custo vem da COTAÇÃO externa, lançada
// pela Controladoria por grupo de despesa. Preço vindo do modelo é plausível e
// ninguém confere — foi para não depender disso que ele saiu do caminho.
//
// ── O que não foi dito fica VAZIO ────────────────────────────────────────
// Mês que a pessoa não disse volta nulo e a linha aparece pedindo o mês. Mês
// chutado pelo modelo entraria no orçamento num mês errado sem ninguém notar —
// e o custo da viagem cai inteiro no mês da partida.
//
// Módulo PURO e testado.
// =============================================================================

export const SYSTEM_PLANO =
  "Você transforma o plano de viagens do ano de uma empresa brasileira em linhas de uma planilha. " +
  "Responde SOMENTE com JSON, sem comentário nem texto fora dele. " +
  "Você não calcula preço, não estima distância e não opina: apenas organiza o que foi dito.";

/** O JSON Schema que vai no system, para o provedor seguir a estrutura exata. */
export const SCHEMA_HINT_PLANO = JSON.stringify(
  {
    type: "object",
    properties: {
      viagens: {
        type: "array",
        items: {
          type: "object",
          properties: {
            destino: { type: "string", description: "Cidade de destino. Obrigatório." },
            mes: {
              type: ["integer", "null"],
              description: "Mês da ida, 1 a 12. null quando não foi dito.",
            },
            noites: { type: ["integer", "null"], description: "Noites fora. 0 em bate-volta." },
            pessoas: { type: ["integer", "null"] },
            pessoasPorQuarto: { type: ["integer", "null"], description: "1 = quarto individual." },
            tipo: { type: ["string", "null"], description: "Nome copiado da lista de tipos." },
            modal: {
              type: ["string", "null"],
              enum: ["aviao", "onibus", "carro", "van", "outro", null],
              description: "Só quando a pessoa disser como vai.",
            },
            finalidade: { type: ["string", "null"], description: "Uma linha: para que serve a viagem." },
            junto: {
              type: ["string", "null"],
              description:
                "Mesma etiqueta nas cidades de uma MESMA ida (ex.: 'sul'). null quando a viagem é a uma cidade só.",
            },
          },
          required: ["destino"],
        },
      },
    },
    required: ["viagens"],
  },
  null,
  0,
);

export interface CadastroPrompt {
  nome: string;
  /** Só nas faixas: o valor curado, para a IA escolher a faixa pela ordem de grandeza. */
  valor?: number;
  /** Só nas faixas de passagem: o modal que a faixa implica. */
  modal?: string | null;
}

function lista(itens: readonly CadastroPrompt[]): string {
  if (itens.length === 0) return "  (nenhum cadastrado)";
  return itens
    .map((i) => {
      const extras: string[] = [];
      if (typeof i.valor === "number" && i.valor > 0) extras.push(`R$ ${i.valor.toFixed(0)}`);
      if (i.modal) extras.push(i.modal);
      return `  - ${i.nome}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
    })
    .join("\n");
}

export interface PromptPlanoInput {
  year: number;
  /** Cidade de partida do time. Entra para a IA não confundir origem com destino. */
  origem: string;
  tipos: readonly CadastroPrompt[];
  /** O que o gestor colou ou ditou, como veio. */
  texto: string;
}

/**
 * Monta a pergunta: os cadastros disponíveis, as regras e o texto do gestor.
 *
 * Os cadastros vão com o VALOR da faixa porque é assim que a escolha fica
 * possível: "Capital Nordeste (R$ 1.200, aviao)" diz à IA o que aquela etiqueta
 * representa. Sem o valor, ela escolheria pelo nome e um destino do Nordeste
 * poderia cair na faixa do Sudeste sem nada denunciar.
 */
export function montarPromptPlano(input: PromptPlanoInput): string {
  const partes: string[] = [];

  partes.push(
    `Orçamento de viagens de ${input.year}. O time parte de ${input.origem || "(origem não informada)"}.`,
  );

  partes.push(
    "",
    "TIPOS DE VIAGEM cadastrados (copie o nome EXATAMENTE):",
    lista(input.tipos),
  );

  partes.push(
    "",
    "REGRAS:",
    "1. Uma linha por viagem. Duas idas ao mesmo destino em meses diferentes são DUAS linhas.",
    "2. NÃO invente viagem que não foi dita, e não complete o ano com viagens plausíveis.",
    "3. O MÊS é o campo que mais importa: o custo da viagem cai inteiro no mês da partida. " +
      'Se a pessoa não disse o mês ("no segundo semestre", "em algum momento"), devolva null — ' +
      "nunca escolha um mês por ela.",
    "4. Escolha o tipo da lista acima, pelo que foi dito, copiando o nome exatamente. Se " +
      "nenhum servir, devolva null em vez de inventar nome.",
    "5. Não devolva preço, custo, total nem distância: não há campo para isso. O preço é " +
      "cotado depois, fora do sistema, pela Controladoria.",
    "6. Bate-volta (sem pernoite) tem noites = 0.",
    '7. Se uma mesma ida passar por mais de uma cidade, emita UMA LINHA POR CIDADE com a mesma ' +
      'etiqueta em "junto" — a grade tem uma cidade por linha, e quem confere precisa ver as duas.',
    "8. O que não foi dito fica null (ou fora do objeto). Não preencha por simetria com as outras " +
      "linhas.",
  );

  partes.push("", "PLANO, como o gestor o escreveu:", input.texto.trim());

  return partes.join("\n");
}
