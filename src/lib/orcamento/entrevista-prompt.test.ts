// Prompt da entrevista base zero.
//
// O que se testa aqui é o que se quebra por engano ao calibrar uma categoria:
// a CLASSE (o que faz sentido perguntar), a MATERIALIDADE (quem merece pacote
// completo), o contexto do realizado e os dois rabos do prompt — entrevista
// (cartões + [[FECHAR]]) e fechamento (só a justificativa).

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemPrompt,
  classeDespesa,
  listaBase,
  materialidade,
  realizadoContexto,
  type BuildSystemPromptInput,
  type EntrevistaBaseItem,
} from "./entrevista-prompt";
import type { MediaRealizado } from "./media-realizado";

const base = (nome: string, valorAno: number, grupoNome: string | null = null): EntrevistaBaseItem => ({
  nome,
  valorAno,
  grupoNome,
});

function prompt(over: Partial<BuildSystemPromptInput> = {}): string {
  return buildSystemPrompt({
    companyName: "Viva Eventos",
    setorNome: "Marketing",
    categoryName: "Softwares, Sistemas e Servidores",
    dreLineCode: "7.2",
    dreLineName: "Despesas Administrativas",
    year: 2027,
    realizado: undefined,
    base: [base("Figma", 4200), base("Trello", 1200)],
    registradas: [],
    grupos: ["Design", "Gestão"],
    contextoAdmin: "",
    modo: "entrevista",
    ...over,
  });
}

// ─── Classe da despesa ───────────────────────────────────────────────────────

test("classe: estrutural para aluguel, impostos e contas de consumo", () => {
  assert.equal(classeDespesa("Aluguel", "Despesas Administrativas"), "estrutural");
  assert.equal(classeDespesa("IPTU", "Tributos"), "estrutural");
  assert.equal(classeDespesa("Energia elétrica", "Despesas Gerais"), "estrutural");
});

test("classe: contratual para assinaturas e sistemas", () => {
  assert.equal(classeDespesa("Softwares, Sistemas e Servidores", "Administrativas"), "contratual");
  assert.equal(classeDespesa("Aluguel de equipamentos", "Administrativas"), "contratual");
});

test("classe: discricionária para consultoria e treinamento", () => {
  assert.equal(classeDespesa("Consultoria", "Administrativas"), "discricionaria");
  assert.equal(classeDespesa("Treinamento e capacitação", "Administrativas"), "discricionaria");
});

test("classe: variável para marketing e manutenção", () => {
  assert.equal(classeDespesa("Marketing", "Comerciais"), "variavel");
  assert.equal(classeDespesa("Manutenção predial", "Gerais"), "variavel");
});

test("classe: sem palavra conhecida devolve null (a IA classifica)", () => {
  assert.equal(classeDespesa("Despesas diversas", "Outras"), null);
});

// ─── Materialidade ───────────────────────────────────────────────────────────

test("materialidade: os itens que somam 80% recebem pacote completo, a cauda vai rápido", () => {
  // 1000, 200 e cinco de 10: os dois primeiros cobrem ~89% do total.
  const m = materialidade([1000, 200, 10, 10, 10, 10, 10]);
  assert.equal(m[0].profundidade, "completa");
  assert.equal(m[1].profundidade, "completa");
  assert.deepEqual(
    m.slice(2).map((x) => x.profundidade),
    ["rapida", "rapida", "rapida", "rapida", "rapida"],
  );
});

test("materialidade: com até 3 itens todos recebem pacote completo", () => {
  const m = materialidade([1000, 5, 1]);
  assert.deepEqual(m.map((x) => x.profundidade), ["completa", "completa", "completa"]);
});

test("materialidade: item com 10% ou mais do total nunca vai para a cauda", () => {
  // O de 150 entra depois do corte de 80%, mas pesa 12% — merece completo.
  const m = materialidade([600, 400, 150, 5, 5, 5, 5]);
  assert.equal(m[2].profundidade, "completa");
  assert.equal(m[3].profundidade, "rapida");
});

test("materialidade: lista vazia ou tudo zero não quebra", () => {
  assert.deepEqual(materialidade([]), []);
  const m = materialidade([0, 0]);
  assert.equal(m.length, 2);
  assert.equal(m[0].peso, 0);
});

test("materialidade: devolve na ordem da lista original, não na ordem do peso", () => {
  const m = materialidade([10, 1000]);
  assert.deepEqual(m.map((x) => x.indice), [0, 1]);
  assert.equal(m[1].totalAno, 1000);
});

// ─── Realizado ───────────────────────────────────────────────────────────────

const realizado = (meses: (number | null)[], media: number | null): MediaRealizado => ({
  meses,
  total: meses.reduce<number>((a, b) => a + (b ?? 0), 0),
  mesesConsiderados: 12,
  media,
});

test("realizadoContexto: traz total, média, mês a mês e aponta meses fora da curva", () => {
  const r = realizado([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 900], 166.67);
  const txt = realizadoContexto(r);
  assert.match(txt, /total/);
  assert.match(txt, /mês a mês/);
  assert.match(txt, /fora da curva/);
  assert.match(txt, /dezembro/);
});

test("realizadoContexto: sem mês fora da curva não inventa aviso", () => {
  const r = realizado([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 100);
  assert.doesNotMatch(realizadoContexto(r), /fora da curva/);
});

test("realizadoContexto: sem dados diz que não há realizado", () => {
  assert.match(realizadoContexto(undefined), /sem dados/i);
  assert.match(realizadoContexto(realizado(Array(12).fill(null), null)), /sem gasto/i);
});

// ─── Prompt ──────────────────────────────────────────────────────────────────

test("prompt: leva os quatro blocos e a pergunta de Drucker", () => {
  const p = prompt();
  assert.match(p, /BLOCO 0/);
  assert.match(p, /BLOCO 1/);
  assert.match(p, /BLOCO 2/);
  assert.match(p, /BLOCO 3/);
  assert.match(p, /contrataria hoje/i);
  assert.match(p, /BASE ZERO/);
});

test("prompt: marca a profundidade de cada item da base", () => {
  const p = prompt({ base: [base("Grande", 100000), base("Médio", 1000), base("Migalha", 5)] });
  assert.match(p, /\[pacote completo\]/);
});

test("prompt: a base é apresentada por valor do ANO, não mensal", () => {
  const txt = listaBase([base("Figma", 4200, "Design")]);
  assert.match(txt, /no ano/);
  assert.match(txt, /grupo: Design/);
  assert.doesNotMatch(txt, /\/mês/);
});

test("prompt: não repete a regra antiga de só perguntar se mantém", () => {
  const p = prompt();
  assert.doesNotMatch(p, /gastou .* em 2026, mantém/i);
});

test("prompt: classe conhecida entra com a condução dela; desconhecida pede à IA para classificar", () => {
  assert.match(prompt(), /CONTRATUAL/);
  const desconhecida = prompt({ categoryName: "Despesas diversas" });
  assert.match(desconhecida, /classifique em silêncio/i);
});

test("prompt: sem base a entrevista é aberta e sem lista de itens", () => {
  const p = prompt({ base: [] });
  assert.match(p, /PREVISÃO ABERTA/);
  // Sem o cabeçalho da base não há lista de itens para confirmar um a um. (A
  // expressão "[pacote completo]" continua no prompt, nos princípios — ela
  // descreve a marcação, não uma lista.)
  assert.doesNotMatch(p, /BASE — o que o setor pagou/);
});

test("prompt: contexto do admin e regra da categoria continuam entrando", () => {
  const p = prompt({ contextoAdmin: "Trocar o Trello pelo Notion em março." });
  assert.match(p, /CONTEXTO DO ADMINISTRADOR/);
  assert.match(p, /Notion/);
  assert.match(prompt({ categoryName: "Pró-labore" }), /SALÁRIO DOS SÓCIOS/);
});

// ─── Os dois modos ───────────────────────────────────────────────────────────

test("prompt: modo entrevista ensina o cartão e o [[FECHAR]]", () => {
  const p = prompt();
  assert.match(p, /\[\[DESPESA\]\]/);
  assert.match(p, /\[\[FECHAR\]\]/);
  assert.match(p, /UM cartão por mensagem/);
});

test("prompt: modo fechamento pede só a justificativa, sem cartão nem roteiro", () => {
  const p = prompt({ modo: "fechamento" });
  assert.match(p, /JUSTIFICATIVA/);
  assert.doesNotMatch(p, /\[\[DESPESA\]\]/);
  assert.doesNotMatch(p, /BLOCO 0/);
});

test("prompt: o cartão FECHA a despesa — ter os dados não autoriza emitir", () => {
  // O defeito que isto tranca: a regra do cartão dizia "quando tiver nome,
  // valor, periodicidade e mês, emita". Gestor que chegava com tudo pronto
  // pulava a entrevista inteira, e a segunda despesa entrava sem uma pergunta.
  const p = prompt();
  assert.match(p, /O cartão FECHA uma despesa/);
  assert.match(p, /NÃO é motivo/);
  assert.match(p, /adiantou a parte/i);
  assert.match(p, /Também não emita/);
});

test("prompt: exige conversa antes do cartão de despesa NOVA", () => {
  const p = prompt();
  assert.match(p, /Despesa NOVA: precisa de/);
  assert.match(p, /pelo menos UMA das/);
  assert.match(p, /não emita cartão na mesma mensagem/);
});

test("prompt: pergunta pela próxima despesa depois de cada cartão", () => {
  // A tela avisa a IA do que o gestor fez com o cartão (confirmou/descartou);
  // sem esta regra ela recebia o aviso e não puxava a próxima despesa.
  const p = prompt();
  assert.match(p, /DEPOIS DE CADA CARTÃO/);
  assert.match(p, /Adicionei ao orçamento/);
  assert.match(p, /Descartei a sugestão/);
  assert.match(p, /ENCERRE PERGUNTANDO PELA PRÓXIMA/);
  assert.match(p, /QUAL é/);
});

test("prompt: valor que muda no meio do ano vira DOIS cartões", () => {
  // O cartão tem um valor só; reajuste no meio do ano não cabe nele. A IA
  // precisa quebrar em trechos com mesFim/mesInicio encaixados.
  const p = prompt();
  assert.match(p, /VALOR QUE MUDA NO MEIO DO ANO/);
  assert.match(p, /DOIS cartões/);
  assert.match(p, /sem buraco e sem sobreposição/);
  assert.match(p, /Ponha o período no nome/);
});

test("prompt: o segundo trecho não é tratado como cartão repetido", () => {
  const p = prompt({
    registradas: [
      {
        descricao: "Facebook Ads (jan–mai)",
        valor: 50,
        periodicidade: "mensal",
        mesInicio: 1,
        mesFim: 5,
        grupoNome: null,
      },
    ],
  });
  assert.match(p, /NÃO emita cartão repetido/);
  assert.match(p, /EXCEÇÃO: o segundo trecho/);
});

test("prompt: duplicidade é levantada como dúvida, nunca como bloqueio", () => {
  const p = prompt();
  assert.match(p, /DUPLICIDADE/);
  assert.match(p, /MESMA COISA ESCRITA DIFERENTE/);
  assert.match(p, /MESMA FINALIDADE, FERRAMENTAS DIFERENTES/);
  // A trava contra uma IA obstrutiva: ela pergunta, o gestor decide.
  assert.match(p, /REGRA DE OURO/);
  assert.match(p, /REGISTRE sem insistir/);
  assert.match(p, /Nunca se recuse a emitir o cartão/);
});

test("prompt: 'para que serve' é obrigatória em TODA despesa", () => {
  const p = prompt();
  assert.match(p, /PARA QUE SERVE \/ QUAL O OBJETIVO/);
  assert.match(p, /OBRIGATÓRIA em TODA despesa/);
  assert.match(p, /inclusive os marcados \[conferência rápida\]/);
});

test("prompt: a conferência rápida da base segue curta", () => {
  // A válvula contra entrevista interminável não pode ser fechada junto.
  assert.match(prompt(), /\[conferência rápida\]: basta o gestor confirmar/);
});

test("prompt: a reflexão vale para toda despesa, não só a primeira", () => {
  assert.match(prompt(), /VALEM PARA TODA DESPESA/);
  assert.match(prompt(), /piloto automático/);
});

test("prompt: as perguntas de reflexão estão no modo entrevista e fora do fechamento", () => {
  const p = prompt();
  assert.match(p, /KPI/);
  assert.match(p, /PROJEÇÃO/i);
  assert.match(p, /OUTROS ORÇAMENTOS/);
  // Elas provocam reflexão; não podem virar campo do cartão.
  assert.match(p, /NÃO as coloque dentro do cartão/);
  assert.doesNotMatch(prompt({ modo: "fechamento" }), /PERGUNTAS DE REFLEXÃO/);
});

// ─── Grupos, setor e despesas já registradas ─────────────────────────────────

test("prompt: lista os grupos disponíveis e manda usar o nome exato", () => {
  const p = prompt({ grupos: ["Design", "Mídia paga"] });
  assert.match(p, /Mídia paga/);
  assert.match(p, /EXATAMENTE um destes nomes/);
});

test("prompt: empresa sem grupos manda deixar em branco e não perguntar", () => {
  const p = prompt({ grupos: [] });
  assert.match(p, /ainda não tem grupos cadastrados/);
  assert.doesNotMatch(p, /EXATAMENTE um destes nomes/);
});

test("prompt: diz de qual setor é o orçamento desta conversa", () => {
  assert.match(prompt({ setorNome: "Comercial" }), /Setor: Comercial/);
  assert.match(prompt({ setorNome: "" }), /não orça por setor/);
});

test("prompt: despesas já registradas entram para a IA não perguntar de novo", () => {
  const p = prompt({
    registradas: [
      {
        descricao: "Figma",
        valor: 350,
        periodicidade: "mensal",
        mesInicio: 1,
        mesFim: null,
        grupoNome: "Design",
      },
    ],
  });
  assert.match(p, /JÁ REGISTRADAS/);
  assert.match(p, /Figma/);
  assert.match(p, /NÃO emita cartão repetido/);
});

test("prompt: mês a mês do realizado entra no cabeçalho", () => {
  const r = realizado([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], 65);
  assert.match(prompt({ realizado: r }), /mês a mês/);
});
