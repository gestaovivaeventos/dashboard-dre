// O guard das rotas de método.
//
// Este teste lê os ARQUIVOS DE ROTA do disco, e é de propósito: a armadilha aqui
// é exatamente a que o CLAUDE.md descreve para módulo novo — esquecer a fiação
// num dos pontos COMPILA LIMPO. Uma rota de método sem o guard continua
// funcionando perfeitamente; ela só deixa entrar, pelo link direto, numa tela que
// a empresa desligou. `tsc`, ESLint e build passam, e o defeito só aparece se
// alguém pensar em colar a URL.
//
// Por isso o teste não exercita a função (ela depende de sessão e banco): ele
// cobra a CHAMADA, em toda rota que seja um método, com a chave certa.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WORKSPACE_TABS } from "./workspace-tabs";

const RAIZ = path.join(
  process.cwd(),
  "src",
  "app",
  "(app)",
  "orcamento",
  "empresa",
  "[companyId]",
  "[ano]",
);

/** Todo `page.tsx` abaixo da pasta de um método (a lista e as sub-rotas dela). */
function paginasDoMetodo(slug: string): string[] {
  const base = path.join(RAIZ, slug);
  if (!fs.existsSync(base)) return [];
  const out: string[] = [];
  const andar = (dir: string) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) andar(p);
      else if (nome === "page.tsx") out.push(p);
    }
  };
  andar(base);
  return out;
}

test("existe uma pasta de rota para cada aba do workspace", () => {
  // Aba sem rota é caixa que leva a 404 — o hub linka por slug.
  for (const tab of WORKSPACE_TABS) {
    assert.ok(
      fs.existsSync(path.join(RAIZ, tab.slug)),
      `aba "${tab.slug}" sem pasta de rota`,
    );
  }
});

test("TODA página de método chama o guard, com a própria chave", () => {
  for (const tab of WORKSPACE_TABS) {
    const paginas = paginasDoMetodo(tab.slug);
    assert.ok(paginas.length > 0, `método "${tab.slug}" sem nenhuma page.tsx`);
    for (const p of paginas) {
      const fonte = fs.readFileSync(p, "utf8");
      const relativo = path.relative(process.cwd(), p);
      assert.match(
        fonte,
        /guardMetodoDaEmpresa\(/,
        `${relativo} não chama guardMetodoDaEmpresa — o link direto entraria numa tela desligada`,
      );
      // A chave errada esconderia o método errado, calado: a rota de viagens
      // guardando "pessoal" passaria no teste acima e liberaria viagens.
      assert.match(
        fonte,
        new RegExp(`guardMetodoDaEmpresa\\(\\s*"${tab.slug}"`),
        `${relativo} chama o guard com uma chave diferente de "${tab.slug}"`,
      );
    }
  }
});

test("o guard não é chamado com uma chave que não é método", () => {
  // Protege contra copiar a chamada de outra rota e esquecer de trocar a chave
  // para algo que nem existe em METODOS.
  const slugs = new Set(WORKSPACE_TABS.map((t) => t.slug));
  for (const tab of WORKSPACE_TABS) {
    for (const p of paginasDoMetodo(tab.slug)) {
      const fonte = fs.readFileSync(p, "utf8");
      // `Array.from` em vez de iterar o matchAll direto: o target deste projeto
      // não permite percorrer o iterador sem downlevelIteration.
      for (const m of Array.from(fonte.matchAll(/guardMetodoDaEmpresa\(\s*"([^"]+)"/g))) {
        assert.ok(slugs.has(m[1]), `${path.relative(process.cwd(), p)}: "${m[1]}" não é um método`);
      }
    }
  }
});
