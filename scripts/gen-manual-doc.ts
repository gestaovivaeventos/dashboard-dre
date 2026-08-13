// Gera o arquivo Word do Manual do módulo Compras a partir do conteúdo do app.
//
//   npx tsx scripts/gen-manual-doc.ts [caminho-de-saida]
//
// Saída padrão: docs/Manual-Modulo-Compras-Control-Hub.doc
//
// É a ÚNICA forma de gerar o Word: a tela /ctrl/manual não oferece download (a
// rota que servia esse botão foi removida a pedido). O arquivo é distribuído
// fora do app. Rode este script sempre que o conteúdo do manual mudar.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { MANUAL_DOC_FILENAME, renderManualWordHtml } from "../src/lib/ctrl/manual/word";

const out = resolve(process.argv[2] ?? `docs/${MANUAL_DOC_FILENAME}`);

// BOM: sem ele o Word abre o HTML como ANSI e quebra os acentos.
writeFileSync(out, "﻿" + renderManualWordHtml(), "utf8");

console.log(`Manual gerado: ${out}`);
