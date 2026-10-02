// Converte o "Controle de Viagens Realizadas" (uma viagem por ABA) no modelo do
// histórico de viagens do Orçamento (uma linha por viagem):
//
//   npx tsx scripts/viagens-historico-convert.ts "[2026] Controle de Viagens Realizadas.xlsx"
//   npx tsx scripts/viagens-historico-convert.ts "<entrada>" "docs/viagens/historico-2026.xlsx"
//
// Sem o 2º argumento só imprime o relatório; com ele grava o modelo para subir na
// tela (Configuração da empresa › Histórico de viagens).
//
// ── Por que um conversor, e não um importador genérico ────────────────────
// A planilha de controle é um documento de trabalho: o bloco PREVISTO à esquerda e
// o REALIZADO à direita, uma linha por despesa, rótulos escritos à mão, e abas com
// layout ligeiramente diferente entre si (coluna de cidade à esquerda nas viagens
// de vários destinos, largura do bloco variando). Ensinar o importador do produto a
// adivinhar isso o tornaria frágil para todo mundo. Aqui o palpite é de uso único e
// o resultado é CONFERÍVEL: sai um modelo que a pessoa olha antes de subir.
//
// ── O que entra em cada grupo, e o que fica de fora ──────────────────────
// O histórico produz DUAS referências por destino: passagem por pessoa e diária por
// quarto. Então:
//
//   passagem   ← avião, ônibus, carro alugado, gasolina, pedágio, bagagem, o
//                "deslocamento X" entre cidades. É "deslocamento entre cidades",
//                que é o que o grupo `passagem` do motor significa.
//   hospedagem ← hotel/pousada. Cada LINHA é uma reserva e "N diárias" são as
//                noites dela, então a soma das diárias é o divisor exato.
//   alimentação← almoço, janta, lanche (vira sugestão do parâmetro da empresa).
//
//   FORA: uber, táxi e estacionamento (transporte LOCAL — o histórico não tem
//   coluna para isso hoje, e somá-los em passagem inflaria o preço por pessoa);
//   cachê (não é custo de viagem: é o pagamento do evento).
//
// Tudo que fica fora é somado e REPORTADO por aba — número que desaparece sem
// aviso é o defeito que este módulo todo existe para evitar.
//
// ── Realizado vence previsto, linha a linha ──────────────────────────────
// Regra do dono da planilha. Célula de realizado vazia cai no previsto DAQUELA
// linha, não da aba inteira: no arquivo real há abas em que metade do realizado
// está preenchido.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as XLSX from "xlsx";

import { parseHistoricoXlsx } from "../src/lib/viagens/historico-xlsx";
import { referenciasPorDestino } from "../src/lib/viagens/historico";

const entrada = process.argv[2];
const saida = process.argv[3];
if (!entrada) {
  console.error('Uso: npx tsx scripts/viagens-historico-convert.ts "<entrada.xlsx>" [saida.xlsx]');
  process.exit(1);
}

const ABAS_IGNORADAS = new Set(["BASE", "GRÁFICOS", "GRAFICOS", "MENU"]);

/** Quantas linhas depois do "TOTAL DO APORTE" ainda podem ser bloco complementar. */
const LIMITE_COMPLEMENTAR = 20;

/** Abreviações que a planilha usa nos nomes de aba. */
const CIDADES_ABREVIADAS: Record<string, string> = {
  sp: "São Paulo",
  bh: "Belo Horizonte",
  gv: "Governador Valadares",
  jp: "João Pessoa",
  rec: "Recife",
  imp: "Imperatriz",
  izа: "Imperatriz",
  vr: "Volta Redonda",
  poa: "Porto Alegre",
  sm: "Santa Maria",
  uba: "Ubá",
  vrd: "Volta Redonda",
};

const txt = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const chave = (v: unknown): string =>
  txt(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = txt(v).replace(/R\$/i, "").replace(/\s/g, "");
  if (!s) return null;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

type Grupo = "passagem" | "hospedagem" | "alimentacao" | "local" | "nao_viagem" | "desconhecido";

/**
 * Em que grupo cai um item.
 *
 * A ordem importa: "Deslocamento de uber" contém "deslocamento", que também marca
 * o deslocamento intercidades — então uber é testado ANTES.
 */
function grupoDoItem(item: string): Grupo {
  const k = chave(item);
  if (!k) return "desconhecido";
  if (/(uber|taxi|estacionamento|translado|transfer)/.test(k)) return "local";
  if (/cache/.test(k)) return "nao_viagem";
  if (/(hotel|hospedagem|pousada|airbnb|hostel)/.test(k)) return "hospedagem";
  if (/(alimentacao|refeica|almoco|janta|lanche|^cafe|reembolso)/.test(k)) return "alimentacao";
  if (
    /(aviao|aerea|aereo|passagem|onibus|localiza|movida|unidas|carro alugado|aluguel|locacao|gasolina|combustivel|pedagio|bagagem|deslocamento|cancelamento)/.test(
      k,
    ) ||
    // "JF x IZA", "POA x SM": deslocamento entre cidades escrito como rota.
    /^[a-z]{2,12}\s*x\s*[a-z]{2,12}$/.test(k)
  ) {
    return "passagem";
  }
  return "desconhecido";
}

/** Modal que o item sugere, para escolher o da viagem pelo MAIOR gasto. */
function modalDoItem(item: string): "aviao" | "onibus" | "carro" | null {
  const k = chave(item);
  if (/(aviao|aerea|aereo)/.test(k)) return "aviao";
  if (/onibus/.test(k)) return "onibus";
  if (/(carro|gasolina|combustivel|pedagio|localiza|movida|unidas|locacao|aluguel|deslocamento)/.test(k)) {
    return "carro";
  }
  return null;
}

const MESES_REF = new Map<number, number>();

/** Lê "19/01 a 25/01", "01 a 06/03", "22/04 a 08/05". Devolve mês e noites. */
function lerPeriodo(s: string): { mes: number | null; noites: number | null } {
  const t = txt(s);
  const m = /(\d{1,2})(?:\/(\d{1,2}))?\s*(?:a|à|até|-)\s*(\d{1,2})\/(\d{1,2})/.exec(t);
  if (!m) {
    // Só uma data ("09/06"): dá o mês, não dá as noites.
    const uma = /(\d{1,2})\/(\d{1,2})/.exec(t);
    return uma ? { mes: Number(uma[2]), noites: null } : { mes: null, noites: null };
  }
  const diaIni = Number(m[1]);
  const mesFim = Number(m[4]);
  const mesIni = m[2] ? Number(m[2]) : mesFim;
  const diaFim = Number(m[3]);
  if (mesIni < 1 || mesIni > 12 || mesFim < 1 || mesFim > 12) return { mes: null, noites: null };
  const ini = Date.UTC(2026, mesIni - 1, diaIni);
  const fim = Date.UTC(2026, mesFim - 1, diaFim);
  const noites = Math.round((fim - ini) / 86_400_000);
  MESES_REF.set(mesIni, (MESES_REF.get(mesIni) ?? 0) + 1);
  return { mes: mesIni, noites: noites >= 0 && noites < 120 ? noites : null };
}

/** "6 diárias", "1 diária" → 6, 1. */
function lerDiarias(...celulas: unknown[]): number | null {
  for (const c of celulas) {
    const m = /(\d{1,3})\s*di[áa]ria/i.exec(txt(c));
    if (m) return Number(m[1]);
  }
  return null;
}

/** "5 pessoas" em qualquer célula de detalhe. */
function lerPessoasExplicito(...celulas: unknown[]): number | null {
  for (const c of celulas) {
    const m = /(\d{1,2})\s*pessoas?/i.exec(txt(c));
    if (m) return Number(m[1]);
  }
  return null;
}

/** Conta nomes em "Ronin e Marina", "Marcola, Humberto e Ever". */
function contarNomes(s: string): number {
  const partes = txt(s)
    .split(/,| e | E |&/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && !/^\d/.test(p));
  return partes.length;
}

interface LinhaBloco {
  item: string;
  detalhes: string[];
  valor: number | null;
}

/** Uma despesa já com o valor decidido entre realizado e previsto. */
interface Despesa {
  cidadeRotulo: string | null;
  item: string;
  detalhes: string[];
  valor: number;
  /** De onde o valor veio, para o relatório. */
  fonte: "realizado" | "previsto";
  /** Veio do bloco complementar: soma no histórico, fica fora da conferência. */
  depoisDoTotal: boolean;
}

interface AbaLida {
  aba: string;
  cidadeBruta: string;
  pessoasTitulo: number;
  /** Rótulo da esquerda, quando a aba é de vários destinos. */
  blocosCidade: Array<{ rotulo: string; primeiraLinha: number }>;
  linhas: Despesa[];
  cabecalho: string;
  fonteTitulo: string;
  /** "TOTAL DO APORTE" da aba — a conferência que denuncia erro de leitura. */
  totalDaAba: number | null;
  /** Há linhas de despesa DEPOIS do "TOTAL DO APORTE" — bloco complementar. */
  sobrou: boolean;
  avisos: string[];
}

/** Um rótulo que identifica a coluna de ITEM de forma confiável. */
function pareceItem(v: unknown): boolean {
  return grupoDoItem(txt(v)) !== "desconhecido";
}

/** Acha a linha e as colunas dos dois blocos (previsto à esquerda, realizado à direita). */
function acharBlocos(
  data: unknown[][],
): { linha: number; colP: number; colR: number } | null {
  for (let i = 0; i < Math.min(data.length, 12); i += 1) {
    const row = data[i] ?? [];
    const prev: number[] = [];
    let real = -1;
    row.forEach((c, idx) => {
      const k = chave(c);
      if (!k) return;
      if (k.includes("previsto")) prev.push(idx);
      if (k.includes("realizado") && real === -1) real = idx;
    });
    if (prev.length > 0 && real > prev[0]) return { linha: i, colP: prev[0], colR: real };
    // A planilha real tem abas em que o 2º bloco também diz "PREVISTO" (cópia que
    // ninguém corrigiu). A 2ª ocorrência é o realizado.
    if (prev.length >= 2) return { linha: i, colP: prev[0], colR: prev[1] };
  }
  return null;
}

/** A coluna de valor dentro de um bloco: a de maior densidade numérica. */
function acharColunaValor(data: unknown[][], ini: number, de: number, ate: number): number {
  const contagem = new Map<number, number>();
  for (let i = ini; i < Math.min(data.length, ini + 40); i += 1) {
    for (let c = de + 1; c < ate; c += 1) {
      if (numero(data[i]?.[c]) != null) contagem.set(c, (contagem.get(c) ?? 0) + 1);
    }
  }
  let melhor = de + 3;
  let max = 0;
  for (const [c, n] of Array.from(contagem.entries())) {
    if (n > max) {
      max = n;
      melhor = c;
    }
  }
  return melhor;
}

function lerAba(nome: string, data: unknown[][]): AbaLida | { erro: string } {
  const blocos = acharBlocos(data);
  if (!blocos) return { erro: "não achei os blocos PREVISTO / REALIZADO" };
  const { linha: hdr, colR } = blocos;
  const avisosLayout: string[] = [];

  // ── A coluna do ITEM vem do CONTEÚDO, não do cabeçalho ──
  // O "PREVISTO" às vezes está sobre a coluna da cidade e não sobre a do item (abas
  // de vários destinos), e aí tudo desanda: o rótulo da cidade era lido como item e
  // a hospedagem inteira sumia. O vocabulário de itens é consistente na planilha
  // ("Hotel", "Alimentação…", "Avião", "ônibus"), então a coluna com mais acertos é
  // a do item.
  let colP = blocos.colP;
  {
    let melhor = -1;
    let max = 0;
    // Só a metade esquerda: um item que exista APENAS no realizado (linha de
    // reembolso, por exemplo) fazia a coluna da direita ganhar a contagem, e aí
    // o passo saía 0 e os dois blocos viravam o mesmo.
    for (let c = 0; c < Math.max(1, colR); c += 1) {
      let n = 0;
      for (let i = hdr + 1; i < Math.min(data.length, hdr + 30); i += 1) {
        if (pareceItem(data[i]?.[c])) n += 1;
      }
      if (n > max) {
        max = n;
        melhor = c;
      }
    }
    if (melhor >= 0 && max >= 2) colP = melhor;
  }

  // ── O PASSO entre os dois blocos ──
  // Não dá para usar `colR - colP`: nas abas de vários destinos o cabeçalho
  // "PREVISTO" do bloco da direita está sobre a coluna da CIDADE, não sobre a do
  // item, e o passo sai 1 coluna curto — a hospedagem inteira desaparecia em
  // silêncio. O passo real vem do rótulo do item, que é o MESMO nos dois blocos:
  // acha-se a coluna à direita cujo texto repete o item da esquerda.
  let passo = colR - colP;
  for (let i = hdr + 1; i < Math.min(data.length, hdr + 25); i += 1) {
    const esquerda = chave(data[i]?.[colP]);
    if (!esquerda || esquerda.length < 3) continue;
    for (let c = colP + 2; c < (data[i] ?? []).length; c += 1) {
      if (chave(data[i]?.[c]) === esquerda) {
        passo = c - colP;
        i = data.length;
        break;
      }
    }
  }

  if (passo < 3) {
    passo = Math.max(3, colR - colP);
    avisosLayout.push(`não achei o espelho do bloco; usei passo ${passo}`);
  }
  const largura = passo;
  const colValorP = acharColunaValor(data, hdr + 1, colP, colP + passo);
  const offValor = colValorP - colP;

  const avisos: string[] = [];
  const [cidadeBruta, ...resto] = nome.split(" - ");
  // O título da aba é cortado em 31 caracteres pelo Excel ("VASSOURAS - Marcola,
  // Humberto e"), então o cabeçalho, quando traz os nomes, é a fonte melhor.
  const cabecalhoTexto = txt(data[hdr]?.[blocos.colP]) || txt(data[hdr]?.[0]);
  const semData = cabecalhoTexto
    .replace(/\d{1,2}(\/\d{1,2})?\s*(a|à|até|e)\s*\d{1,2}\/\d{1,2}/g, "")
    .replace(/\d{1,2}\/\d{1,2}/g, "")
    .replace(/-?\s*(PREVISTO|REALIZADO)\s*-?/gi, "")
    .replace(/^[\s-]+|[\s-]+$/g, "");
  // Exige ao menos um "nome": 3+ letras que não sejam mês nem palavra de controle.
  // Sem isso, um cabeçalho só com datas virava "1 pessoa" e atropelava a contagem
  // pelo título da aba, que é melhor.
  const pareceNome = /[A-Za-zÀ-ÿ]{3,}/.test(
    semData.replace(/(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|valores|referente)/gi, ""),
  );
  const pessoasCabecalho = pareceNome ? contarNomes(semData) : 0;
  const pessoasTitulo = Math.max(1, pessoasCabecalho || contarNomes(resto.join(" - ")));
  const fonteTitulo = pessoasCabecalho > 0 ? "nomes no cabeçalho da aba" : "nomes no título da aba";

  const brutos: Array<{
    cidadeRotulo: string | null;
    previsto: LinhaBloco;
    realizado: LinhaBloco;
    depoisDoTotal: boolean;
  }> = [];
  const blocosCidade: AbaLida["blocosCidade"] = [];
  let cidadeAtual: string | null = null;
  let sobrou = false;
  let totalDaAba: number | null = null;

  // ── Os dois blocos TERMINAM em linhas diferentes ──
  // O realizado costuma ter linhas que o previsto não tem (um reembolso, um táxi que
  // não estava no plano), então o "TOTAL DO APORTE" dele fica mais abaixo. Parar os
  // dois no primeiro total que aparece cortava o fim do realizado E capturava como
  // "total da aba" o valor de uma linha de despesa qualquer — foi assim que uma aba
  // apareceu na conferência com total de R$ 124,88. Cada lado fecha no seu próprio
  // total.
  let fimPrev = false;
  let fimReal = false;
  let totalPrev: number | null = null;
  let totalReal: number | null = null;
  let vazias = 0;
  let ultimaLinha = hdr;
  let depoisDoTotal = false;
  let jaTeveTotal = false;
  let inicioComplementar = 0;

  const ehTotal = (v: unknown) => /^total/i.test(chave(v));

  for (let i = hdr + 1; i < data.length && !(fimPrev && fimReal); i += 1) {
    const row = data[i] ?? [];
    const colReal = colP + passo;

    // O "TOTAL DO APORTE" fica na coluna do item em algumas abas e na coluna da
    // CIDADE em outras — olhar só uma delas fazia o laço atravessar o total e
    // engolir o bloco complementar de baixo como se fosse uma viagem nova.
    if (!fimPrev && (ehTotal(row[colP]) || (colP > 0 && ehTotal(row[colP - 1])))) {
      fimPrev = true;
      // Só o PRIMEIRO total conta para a conferência: o complementar tem o seu.
      if (!jaTeveTotal) totalPrev = numero(row[colP + offValor]);
    }
    if (!fimReal && (ehTotal(row[colReal]) || (colReal > 0 && ehTotal(row[colReal - 1])))) {
      fimReal = true;
      if (!jaTeveTotal) totalReal = numero(row[colReal + offValor]);
    }
    // O bloco COMPLEMENTAR abaixo do total entra na conta (decisão do dono da
    // planilha): são despesas reais da mesma viagem, e deixá-las fora fazia o hotel
    // de Recife sair menor do que foi pago. A leitura NÃO para no total — ela segue
    // até a planilha acabar de falar. O que o total marca é o fim do que entra na
    // CONFERÊNCIA: o "TOTAL DO APORTE" da aba não inclui o complementar, então somar
    // tudo ali faria 3 abas divergirem sem erro nenhum de leitura.
    if (fimPrev && fimReal) {
      // O bloco COMPLEMENTAR abaixo do total entra na conta (decisão do dono da
      // planilha): são despesas reais da mesma viagem. Mas isso libera UM bloco, não
      // a planilha inteira — sem o freio o laço varria as 1000 linhas da aba e
      // recolhia gráfico, rascunho e o que mais estivesse lá embaixo (R$ 166 mil de
      // lixo na primeira tentativa). Então: reabre uma vez só, e no máximo por
      // LIMITE_COMPLEMENTAR linhas.
      if (jaTeveTotal) break;
      jaTeveTotal = true;
      depoisDoTotal = true;
      inicioComplementar = i;
      fimPrev = false;
      fimReal = false;
      continue;
    }
    if (depoisDoTotal && i - inicioComplementar > LIMITE_COMPLEMENTAR) break;

    // Coluna à esquerda do bloco: o rótulo da cidade nas viagens multi-destino.
    if (colP > 0 && !fimPrev) {
      const rotulo = txt(row[colP - 1]);
      // Precisa COMEÇAR com letra: o cabeçalho do bloco complementar é uma data
      // ("27 e 28/04 - Valores referentes a…") e virava um destino chamado
      // "27 e 28/04", com as despesas da viagem penduradas nele.
      if (rotulo && /^[A-Za-zÀ-ÿ]/.test(rotulo) && !ehTotal(rotulo)) {
        cidadeAtual = rotulo;
        blocosCidade.push({ rotulo, primeiraLinha: i });
      }
    }

    const ler = (base: number): LinhaBloco => ({
      item: txt(data[i]?.[base]),
      detalhes: [1, 2, 3]
        .map((d) => txt(data[i]?.[base + d]))
        .filter((d) => d !== "" && d !== txt(data[i]?.[base + offValor])),
      valor: numero(data[i]?.[base + offValor]),
    });

    const vazio: LinhaBloco = { item: "", detalhes: [], valor: null };
    const prev = fimPrev ? vazio : ler(colP);
    const real = fimReal ? vazio : ler(colReal);

    // A linha entra se QUALQUER um dos lados tem item. Exigir o item do previsto
    // descartava as linhas que existem só no realizado — reembolsos lançados depois
    // —, e elas somavam centenas de reais que desapareciam sem aviso.
    if (!prev.item && !real.item) {
      vazias += 1;
      // Nem toda aba tem "TOTAL DO APORTE" nos dois lados; uma sequência de linhas
      // vazias encerra a leitura em vez de varrer as 1000 linhas da planilha.
      if (vazias >= 8) break;
      continue;
    }
    vazias = 0;
    ultimaLinha = i;
    brutos.push({ cidadeRotulo: cidadeAtual, previsto: prev, realizado: real, depoisDoTotal });
  }

  // Zero não é um total: em algumas abas a célula do realizado está vazia, e aí o
  // que vale para conferir é o total do previsto.
  totalDaAba =
    (totalReal != null && totalReal > 0 ? totalReal : null) ??
    (totalPrev != null && totalPrev > 0 ? totalPrev : null);

  sobrou = brutos.some((b) => b.depoisDoTotal);

  avisos.push(...avisosLayout);

  // ── O pareamento é por RÓTULO, nunca por posição ──
  // Há abas em que o realizado tem uma linha a mais (um reembolso lançado no meio),
  // e dali para baixo os dois blocos ficam deslocados: casar por posição faria
  // "Gasolina" herdar o valor de "Localiza" — erro grande e absolutamente invisível
  // no resultado. Casando o k-ésimo "Gasolina" do previsto com o k-ésimo do
  // realizado, a inserção de linhas deixa de importar.
  const porRotulo = new Map<string, { prev: LinhaBloco[]; real: LinhaBloco[] }>();
  const ordem: string[] = [];
  const depois = new Map<string, boolean>();
  const registre = (
    cidade: string | null,
    l: LinhaBloco,
    lado: "prev" | "real",
    dt: boolean,
  ) => {
    if (!l.item) return;
    // O bloco complementar é uma OCORRÊNCIA a mais do mesmo rótulo ("Hotel Recife"
    // de novo), e é isso que o pareamento por rótulo já sabe tratar.
    const k = `${cidade ?? ""}|${chave(l.item)}|${dt ? "c" : ""}`;
    if (!porRotulo.has(k)) {
      porRotulo.set(k, { prev: [], real: [] });
      ordem.push(k);
      depois.set(k, dt);
    }
    porRotulo.get(k)![lado].push(l);
  };
  for (const b of brutos) {
    registre(b.cidadeRotulo, b.previsto, "prev", b.depoisDoTotal);
    registre(b.cidadeRotulo, b.realizado, "real", b.depoisDoTotal);
  }

  const linhas: Despesa[] = [];
  for (const k of ordem) {
    const { prev, real } = porRotulo.get(k)!;
  const cidadeRotulo = k.split("|")[0] || null;
    const quantos = Math.max(prev.length, real.length);
    for (let j = 0; j < quantos; j += 1) {
      const p = prev[j];
      const r = real[j];
      const base = r ?? p;
      if (!base) continue;
      // ZERO explícito no realizado é um VALOR, não ausência: é como a planilha
      // registra o item cancelado ("Localiza ... 0 / cancelado"). Tratá-lo como
      // vazio fazia o previsto voltar e cobrar R$ 770 de um carro que não foi
      // alugado. Só a célula EM BRANCO cai no previsto.
      const usaReal = r != null && r.valor != null;
      const valor = usaReal ? r!.valor! : (p?.valor ?? 0);
      linhas.push({
        cidadeRotulo,
        item: base.item,
        detalhes: Array.from(new Set([...(p?.detalhes ?? []), ...(r?.detalhes ?? [])])),
        valor,
        fonte: usaReal ? "realizado" : "previsto",
        depoisDoTotal: depois.get(k) ?? false,
      });
    }
  }

  return {
    aba: nome,
    cidadeBruta,
    pessoasTitulo,
    blocosCidade,
    linhas,
    cabecalho: `${cabecalhoTexto} ${txt(data[hdr]?.[colP + passo])}`.trim(),
    fonteTitulo,
    totalDaAba,
    sobrou,
    avisos,
  };
}

interface Viagem {
  aba: string;
  cidade: string;
  mes: number | null;
  pessoas: number;
  fontePessoas: string;
  noites: number | null;
  diarias: number | null;
  modal: string | null;
  passagem: number;
  hospedagem: number;
  alimentacao: number;
  transporteLocal: number;
  /** O que não entrou, por grupo, para o relatório. */
  fora: Record<string, number>;
  /** Total da aba × soma lida — a conferência. `null` quando a aba é multi-destino. */
  totalAba: number | null;
  somaLida: number;
  /** Só as linhas cujo valor veio do REALIZADO — compara com o total da aba. */
  somaRealizado: number;
  avisos: string[];
}

function nomeDaCidade(bruto: string): { cidade: string; aviso?: string } {
  const limpo = txt(bruto);
  const k = chave(limpo).replace(/\./g, "");
  const conhecida = CIDADES_ABREVIADAS[k];
  if (conhecida) return { cidade: conhecida };
  if (limpo.length <= 4) {
    return { cidade: limpo, aviso: `"${limpo}" parece abreviação — confirme a cidade` };
  }
  // "Londrina e Cascavel", "Passos e Piracicaba": a aba é de duas cidades, mas sem
  // blocos separados não há como dividir hotel e passagem entre elas. Vira UMA linha
  // com nome composto — que não casa com viagem futura a nenhuma das duas, e por isso
  // precisa de decisão de quem orça.
  if (/\s(e|E)\s|,/.test(limpo)) {
    return {
      cidade: limpo,
      aviso: `"${limpo}" tem duas cidades numa linha — separe ou escolha a principal`,
    };
  }
  // "MONTES CLAROS" → "Montes Claros" (a planilha escreve em caixa alta).
  const titulo = limpo
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((p) => (p.length <= 2 ? p : p[0].toLocaleUpperCase("pt-BR") + p.slice(1)))
    .join(" ");
  return { cidade: titulo };
}

function converter(lida: AbaLida): Viagem[] {
  const multi = lida.blocosCidade.length > 1;
  const cidades = multi
    ? Array.from(new Set(lida.blocosCidade.map((b) => b.rotulo)))
    : [lida.cidadeBruta];

  const saidaViagens: Viagem[] = [];

  for (const rotuloCidade of cidades) {
    const doGrupo = multi
      ? lida.linhas.filter((l) => l.cidadeRotulo === rotuloCidade)
      : lida.linhas;

    // O rótulo da cidade nas abas multi traz o próprio período: "RECIFE - 27/04 a 01/05".
    const periodoTexto = multi ? rotuloCidade : lida.cabecalho;
    const { mes, noites } = lerPeriodo(periodoTexto);
    const brutoNome = multi ? rotuloCidade.split(" - ")[0] : rotuloCidade;
    const { cidade, aviso: avisoCidade } = nomeDaCidade(brutoNome);

    const avisos = [...lida.avisos];
    if (avisoCidade) avisos.push(avisoCidade);
    if (lida.sobrou) {
      avisos.push('inclui o bloco complementar abaixo do "TOTAL DO APORTE"');
    }

    let passagem = 0;
    let hospedagem = 0;
    let alimentacao = 0;
    let diarias = 0;
    let reservasSemDiarias = 0;
    const fora: Record<string, number> = {};
    const porModal = new Map<string, number>();
    let transporteLocal = 0;
    let somaRealizado = 0;
    let pessoasExplicito: number | null = null;
    let idaEVolta = 0;
    const sufixosPessoa = new Set<string>();

    for (const l of doGrupo) {
      const item = l.item;
      const valor = l.valor;
      const detalhes = l.detalhes;
      const grupo = grupoDoItem(item);
      // A conferência compara com o "TOTAL DO APORTE" da aba, que NÃO inclui o
      // bloco complementar — então ele fica fora dela, embora entre no histórico.
      if (l.fonte === "realizado" && !l.depoisDoTotal) somaRealizado += valor;

      pessoasExplicito = pessoasExplicito ?? lerPessoasExplicito(...detalhes);

      // "Alimentação (almoço e janta) - Ronin" revela o tamanho do grupo.
      const sufixo = /-\s*([A-Za-zÀ-ÿ]{3,})\s*$/.exec(item);
      if (sufixo && grupo === "alimentacao") sufixosPessoa.add(chave(sufixo[1]));

      if (grupo === "hospedagem") {
        hospedagem += valor;
        const n = lerDiarias(...detalhes);
        if (n == null) {
          // Assumir 1 diária era o pior erro possível aqui: R$ 1.344 de hotel em
          // "1 diária" vira uma diária de R$ 1.344 — quatro vezes a real, e com
          // cara de número apurado. Sem o nº, a reserva fica sem diárias e a aba
          // é marcada para conferência.
          reservasSemDiarias += 1;
        } else {
          diarias += n;
        }
        continue;
      }
      if (grupo === "alimentacao") {
        alimentacao += valor;
        continue;
      }
      if (grupo === "local") {
        transporteLocal += valor;
        continue;
      }
      if (grupo === "passagem") {
        passagem += valor;
        const m = modalDoItem(item);
        if (m) porModal.set(m, (porModal.get(m) ?? 0) + valor);
        if (detalhes.some((d) => /ida e volta/i.test(d)) && /(aviao|aerea|onibus)/.test(chave(item))) {
          idaEVolta += 1;
        }
        continue;
      }
      if (valor > 0) fora[grupo] = (fora[grupo] ?? 0) + valor;
      if (grupo === "desconhecido" && valor > 0) {
        avisos.push(`item não classificado: "${item}" (R$ ${valor.toFixed(2)})`);
      }
    }

    // ── PESSOAS: o campo crítico, com a fonte sempre dita ──
    let pessoas = pessoasExplicito ?? 0;
    let fontePessoas = "declarado na planilha";
    if (!pessoas && idaEVolta > 0 && !multi) {
      pessoas = idaEVolta;
      fontePessoas = `${idaEVolta} passagem(ns) ida e volta`;
    }
    if (!pessoas && sufixosPessoa.size > 1) {
      pessoas = sufixosPessoa.size;
      fontePessoas = `${sufixosPessoa.size} pessoas nas linhas de alimentação`;
    }
    if (!pessoas) {
      pessoas = lida.pessoasTitulo;
      fontePessoas = lida.fonteTitulo;
      avisos.push(`CONFIRA as pessoas: contei pelos ${lida.fonteTitulo}`);
    }

    if (reservasSemDiarias > 0) {
      avisos.push(
        `${reservasSemDiarias} reserva(s) de hotel sem "N diárias" — a diária desta viagem sai pelo nº de noites, confira`,
      );
    }

    const modal = Array.from(porModal.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    saidaViagens.push({
      aba: lida.aba,
      cidade,
      mes,
      pessoas,
      fontePessoas,
      noites: noites ?? (diarias > 0 ? diarias : null),
      diarias: diarias > 0 ? diarias : null,
      modal,
      passagem,
      hospedagem,
      alimentacao,
      transporteLocal,
      fora,
      totalAba: multi ? null : lida.totalDaAba,
      somaLida:
        passagem +
        hospedagem +
        alimentacao +
        transporteLocal +
        Object.values(fora).reduce((a, b) => a + b, 0),
      somaRealizado,
      avisos,
    });
  }

  return saidaViagens;
}

// ─── Execução ────────────────────────────────────────────────────────────────

const caminho = resolve(entrada);
const wb = XLSX.read(new Uint8Array(readFileSync(caminho)), { type: "array" });

const viagens: Viagem[] = [];
const falhas: string[] = [];

for (const nome of wb.SheetNames) {
  if (ABAS_IGNORADAS.has(nome.toUpperCase())) continue;
  const ws = wb.Sheets[nome];
  if (!ws) continue;
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" });
  const lida = lerAba(nome, data);
  if ("erro" in lida) {
    falhas.push(`${nome}: ${lida.erro}`);
    continue;
  }
  viagens.push(...converter(lida));
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

console.log(`\nArquivo: ${caminho}`);
console.log(`Abas convertidas: ${wb.SheetNames.length - 3} → ${viagens.length} viagem(ns)\n`);

console.log(
  [
    "CIDADE".padEnd(24),
    "MÊS".padStart(4),
    "PES".padStart(4),
    "NOI".padStart(4),
    "DIÁ".padStart(4),
    "MODAL".padEnd(7),
    "PASSAGEM".padStart(12),
    "HOTEL".padStart(12),
    "ALIM".padStart(11),
    "LOCAL".padStart(10),
    "/PESSOA IDA".padStart(12),
    "/QUARTO".padStart(10),
  ].join(" "),
);
console.log("─".repeat(116));

for (const v of viagens) {
  const porPessoa = v.passagem > 0 && v.pessoas > 0 ? v.passagem / v.pessoas / 2 : null;
  const porQuarto = v.hospedagem > 0 && (v.diarias ?? 0) > 0 ? v.hospedagem / v.diarias! : null;
  console.log(
    [
      v.cidade.slice(0, 24).padEnd(24),
      String(v.mes ?? "—").padStart(4),
      String(v.pessoas).padStart(4),
      String(v.noites ?? "—").padStart(4),
      String(v.diarias ?? "—").padStart(4),
      (v.modal ?? "—").padEnd(7),
      brl(v.passagem).padStart(12),
      brl(v.hospedagem).padStart(12),
      brl(v.alimentacao).padStart(11),
      brl(v.transporteLocal).padStart(10),
      (porPessoa == null ? "—" : brl(porPessoa)).padStart(12),
      (porQuarto == null ? "—" : brl(porQuarto)).padStart(10),
    ].join(" "),
  );
}

// ── CONFERÊNCIA: a soma lida × o "TOTAL DO APORTE" da própria aba ──
// É o teste que denuncia leitura errada — bloco desalinhado, coluna de valor
// trocada, linha engolida. Sem ele o conversor poderia estar errado por 20% e o
// relatório pareceria perfeito. Abas multi-destino não entram: o total delas é da
// viagem inteira, e aqui cada cidade é uma linha.
// A comparação justa é com a soma do REALIZADO: o "TOTAL DO APORTE" da aba conta
// célula vazia como zero, enquanto a conversão cai no previsto daquela linha (a
// regra do dono da planilha). Então:
//   somaRealizado ≈ totalAba  → a LEITURA está certa;
//   somaLida > totalAba       → é o previsto completando linha em branco, esperado.
// Separar os dois é o que distingue "diferença de critério" de "erro de leitura".
const TOLERANCIA = 1;
const conferiveis = viagens.filter((v) => v.totalAba != null);
const lendoErrado = conferiveis.filter(
  (v) => Math.abs(v.somaRealizado - (v.totalAba as number)) > TOLERANCIA,
);
const soCriterio = conferiveis.filter(
  (v) =>
    Math.abs(v.somaRealizado - (v.totalAba as number)) <= TOLERANCIA &&
    Math.abs(v.somaLida - (v.totalAba as number)) > TOLERANCIA,
);
console.log(`
── CONFERÊNCIA com o TOTAL DO APORTE (${conferiveis.length} abas) ──`);
console.log(
  `  ${conferiveis.length - lendoErrado.length} fecham no centavo contra o realizado da aba ` +
    `(${soCriterio.length} delas ficam acima só porque o previsto completou linha em branco)`,
);
if (lendoErrado.length > 0) {
  console.log(`  ${lendoErrado.length} NÃO fecham — leitura a investigar:`);
  for (const v of lendoErrado) {
    const dif = v.somaRealizado - (v.totalAba as number);
    console.log(
      `   ${v.aba.slice(0, 32).padEnd(32)} realizado lido ${brl(v.somaRealizado).padStart(12)}  ` +
        `aba ${brl(v.totalAba as number).padStart(12)}  dif ${brl(dif).padStart(11)}`,
    );
  }
}

// ── O que ficou de fora, somado: número que desaparece sem aviso é defeito ──
const foraTotal: Record<string, number> = {};
for (const v of viagens) {
  for (const [g, val] of Object.entries(v.fora)) foraTotal[g] = (foraTotal[g] ?? 0) + val;
}
console.log("\n── FORA do histórico (por decisão, ver o cabeçalho do script) ──");
for (const [g, val] of Object.entries(foraTotal).sort((a, b) => b[1] - a[1])) {
  const rotulo =
    g === "local"
      ? "uber / táxi / estacionamento (transporte local)"
      : g === "nao_viagem"
        ? "cachê (não é custo de viagem)"
        : "NÃO CLASSIFICADO";
  console.log(`  ${brl(val).padStart(14)}  ${rotulo}`);
}

const naoClassificados = new Map<string, number>();
for (const v of viagens) {
  for (const a of v.avisos) {
    const m = /item não classificado: "(.+)" \(R\$ ([\d.]+)\)/.exec(a);
    if (m) naoClassificados.set(m[1], (naoClassificados.get(m[1]) ?? 0) + Number(m[2]));
  }
}
if (naoClassificados.size > 0) {
  console.log(`
── ITENS NÃO CLASSIFICADOS (${naoClassificados.size}) ──`);
  for (const [item, val] of Array.from(naoClassificados.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${brl(val).padStart(13)}  ${item}`);
  }
}

const comAviso = viagens.filter((v) => v.avisos.length > 0);
if (comAviso.length > 0) {
  console.log(`\n── A CONFERIR (${comAviso.length}) ──`);
  for (const v of comAviso) {
    console.log(`  ${v.aba} → ${v.cidade}`);
    for (const a of Array.from(new Set(v.avisos))) console.log(`      · ${a}`);
  }
}

console.log("\n── Fonte do nº de pessoas ──");
const fontes = new Map<string, number>();
for (const v of viagens) {
  const f = v.fontePessoas.replace(/^\d+ /, "N ");
  fontes.set(f, (fontes.get(f) ?? 0) + 1);
}
for (const [f, n] of Array.from(fontes.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}x  ${f}`);
}

if (falhas.length > 0) {
  console.log(`\n── ABAS NÃO LIDAS (${falhas.length}) ──`);
  for (const f of falhas) console.log(`  · ${f}`);
}

// ── O modelo ──
if (saida) {
  const cabecalho = [
    "Cidade",
    "Mês",
    "Pessoas",
    "Noites",
    "Pessoas por quarto",
    "Diárias (quartos x noites)",
    "Modal",
    "Passagem",
    "Hospedagem",
    "Alimentação",
    "Transporte local / translado",
    "Observação",
  ];
  const linhas: unknown[][] = [cabecalho];
  for (const v of viagens) {
    linhas.push([
      v.cidade,
      v.mes ?? "",
      v.pessoas,
      v.noites ?? "",
      "",
      v.diarias ?? "",
      v.modal ?? "",
      v.passagem > 0 ? Number(v.passagem.toFixed(2)) : "",
      v.hospedagem > 0 ? Number(v.hospedagem.toFixed(2)) : "",
      v.alimentacao > 0 ? Number(v.alimentacao.toFixed(2)) : "",
      v.transporteLocal > 0 ? Number(v.transporteLocal.toFixed(2)) : "",
      `${v.aba} · pessoas: ${v.fontePessoas}`,
    ]);
  }
  const out = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = [
    { wch: 24 },
    { wch: 6 },
    { wch: 8 },
    { wch: 7 },
    { wch: 18 },
    { wch: 24 },
    { wch: 8 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 26 },
    { wch: 52 },
  ];
  XLSX.utils.book_append_sheet(out, ws, "Viagens");
  const destino = resolve(saida);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, XLSX.write(out, { type: "buffer", bookType: "xlsx" }) as Buffer);
  console.log(`\nModelo gravado em: ${destino}`);
  // ── Fecha o ciclo: o arquivo gerado passa pelo PARSER DE VERDADE ──
  // Conferir a conversão contra a minha própria leitura não prova nada. Reler o
  // arquivo com o parser do importador e com o motor de referências mostra o número
  // que o orçamento VAI usar — e pega de graça qualquer coluna fora de lugar.
  const relido = XLSX.read(new Uint8Array(readFileSync(destino)), { type: "array" });
  const conferido = parseHistoricoXlsx(
    XLSX.utils.sheet_to_json<unknown[]>(relido.Sheets.Viagens, {
      header: 1,
      blankrows: true,
      defval: "",
    }),
  );
  if ("erro" in conferido) {
    console.log(`\n!! o importador NÃO leria este arquivo: ${conferido.erro}`);
  } else {
    const { rows, problemas } = conferido.parse;
    console.log(`\n── O IMPORTADOR leu ${rows.length} de ${viagens.length} linha(s) ──`);
    for (const pr of problemas) console.log(`   · ${pr}`);

    const refs = referenciasPorDestino(rows);
    console.log("\n── REFERÊNCIA FINAL por destino (ainda sem reajuste) ──");
    console.log(
      `  ${"DESTINO".padEnd(26)}${"VIAGENS".padStart(8)}${"PASSAGEM/PESSOA".padStart(17)}${"DIÁRIA/QUARTO".padStart(15)}`,
    );
    for (const r of Array.from(refs.values()).sort((a, b) =>
      a.cidade.localeCompare(b.cidade, "pt-BR"),
    )) {
      console.log(
        `  ${r.cidade.slice(0, 26).padEnd(26)}${String(r.viagens).padStart(8)}` +
          `${(r.passagemPorPessoa == null ? "—" : brl(r.passagemPorPessoa)).padStart(17)}` +
          `${(r.diariaPorQuarto == null ? "—" : brl(r.diariaPorQuarto)).padStart(15)}`,
      );
    }
  }

  console.log("\nConfira a coluna Pessoas e as linhas marcadas acima antes de subir.\n");
} else {
  console.log("\n(Para gravar o modelo, passe o arquivo de saída como 2º argumento.)\n");
}
