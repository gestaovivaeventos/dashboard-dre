// Leitura da planilha de grupos (Setor | Categoria | Grupo).
//
// O que se testa aqui é o que quebra com planilha de verdade: cabeçalho que não
// está na primeira linha, colunas fora de ordem, acento e caixa divergentes,
// linha em branco no meio e setor vazio — que NÃO é erro, é "vale para
// qualquer setor".

import test from "node:test";
import assert from "node:assert/strict";

import { parseGruposXlsx, resolverGrupos, normalizarChave } from "./grupos-xlsx";

function linhas(parse: ReturnType<typeof parseGruposXlsx>) {
  assert.ok("parse" in parse, "erro" in parse ? parse.erro : "");
  return parse.parse;
}

test("lê o formato básico", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Setor", "Categoria", "Grupo"],
      ["Marketing", "Publicidade e Propaganda", "Mídia paga"],
      ["Marketing", "Publicidade e Propaganda", "Produção"],
    ]),
  );
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.rows[0], {
    linha: 2,
    setor: "Marketing",
    categoria: "Publicidade e Propaganda",
    grupo: "Mídia paga",
  });
});

test("cabeçalho pode estar fora da primeira linha e com colunas em outra ordem", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Grupos de despesa — 2027"],
      [],
      ["Grupo", "Setor", "Categoria"],
      ["Mídia paga", "Marketing", "Publicidade"],
    ]),
  );
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].grupo, "Mídia paga");
  assert.equal(p.rows[0].setor, "Marketing");
});

test("aceita sinônimos de cabeçalho", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Departamento", "Categoria de despesa", "Subgrupo"],
      ["TI", "Softwares", "Design"],
    ]),
  );
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].setor, "TI");
});

test("SETOR VAZIO não é erro: vale para qualquer setor", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Setor", "Categoria", "Grupo"],
      ["", "Softwares", "Design"],
    ]),
  );
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].setor, "");
  assert.equal(p.problemas.length, 0);
});

test("planilha sem coluna Setor é aceita — tudo vira escopo amplo", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Categoria", "Grupo"],
      ["Softwares", "Design"],
    ]),
  );
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].setor, "");
});

test("sem Categoria ou sem Grupo a planilha inteira é recusada", () => {
  const r = parseGruposXlsx([["Setor", "Grupo"], ["Marketing", "Mídia"]]);
  assert.ok("erro" in r);
  assert.match(r.erro, /cabeçalho/i);
});

test("linha em branco é separador; linha incompleta vira problema", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Setor", "Categoria", "Grupo"],
      ["Marketing", "Publicidade", "Mídia"],
      [],
      ["Marketing", "", "Órfão"],
      ["Marketing", "Publicidade", ""],
    ]),
  );
  assert.equal(p.rows.length, 1);
  assert.equal(p.problemas.length, 2);
  assert.match(p.problemas[0], /Linha 4.*categoria/i);
  assert.match(p.problemas[1], /Linha 5.*grupo/i);
});

test("a mesma linha repetida entra uma vez só", () => {
  const p = linhas(
    parseGruposXlsx([
      ["Setor", "Categoria", "Grupo"],
      ["Marketing", "Publicidade", "Mídia"],
      ["MARKETING", "publicidade", "mídia"],
    ]),
  );
  assert.equal(p.rows.length, 1);
});

// ─── Casamento com o cadastro ────────────────────────────────────────────────

const setores = [
  { id: "s1", name: "Marketing" },
  { id: "s2", name: "Comercial" },
];
const categorias = [
  { categoryCode: "2.01.03", categoryName: "Publicidade e Propaganda" },
  { categoryCode: "2.02.01", categoryName: "Softwares" },
];

test("casa setor e categoria ignorando acento e caixa", () => {
  const r = resolverGrupos(
    [{ linha: 2, setor: "marketing", categoria: "publicidade e propaganda", grupo: "Mídia" }],
    setores,
    categorias,
  );
  assert.equal(r.problemas.length, 0);
  assert.equal(r.resolvidas[0].setorId, "s1");
  assert.equal(r.resolvidas[0].categoryCode, "2.01.03");
});

test("categoria casa também pelo CÓDIGO", () => {
  const r = resolverGrupos(
    [{ linha: 2, setor: "Marketing", categoria: "2.02.01", grupo: "Design" }],
    setores,
    categorias,
  );
  assert.equal(r.resolvidas[0].categoryCode, "2.02.01");
});

test("setor vazio resolve para escopo amplo (setorId nulo)", () => {
  const r = resolverGrupos(
    [{ linha: 2, setor: "", categoria: "Softwares", grupo: "Design" }],
    setores,
    categorias,
  );
  assert.equal(r.resolvidas[0].setorId, null);
  assert.equal(r.problemas.length, 0);
});

test("uma linha errada não derruba as certas", () => {
  // É a regra que torna a importação utilizável: um setor escrito errado no
  // meio de 200 linhas não pode impedir as 199 corretas de entrar.
  const r = resolverGrupos(
    [
      { linha: 2, setor: "Marketing", categoria: "Softwares", grupo: "Design" },
      { linha: 3, setor: "Jurídico", categoria: "Softwares", grupo: "Design" },
      { linha: 4, setor: "Comercial", categoria: "Inexistente", grupo: "X" },
    ],
    setores,
    categorias,
  );
  assert.equal(r.resolvidas.length, 1);
  assert.equal(r.problemas.length, 2);
  assert.match(r.problemas[0], /Jurídico.*não existe/i);
  assert.match(r.problemas[1], /Inexistente.*não encontrada/i);
});

test("normalizarChave tira acento, caixa e espaço duplicado", () => {
  assert.equal(normalizarChave("  MÍDIA   paga "), "midia paga");
});
