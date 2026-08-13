// Gera o arquivo Word do Manual do módulo Compras a partir do conteúdo do app.
//
//   npx tsx scripts/gen-manual-doc.ts [caminho-de-saida]
//
// Saída padrão: docs/Manual-Modulo-Compras-Control-Hub.doc
//
// O mesmo conteúdo é servido em tempo real pela rota /api/ctrl/manual (botão
// "Baixar em Word" na tela /ctrl/manual). Este script existe só para deixar uma
// cópia do arquivo versionada/compartilhável sem precisar subir o app.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { MANUAL_DOC_FILENAME, renderManualWordHtml } from "../src/lib/ctrl/manual/word";

const out = resolve(process.argv[2] ?? `docs/${MANUAL_DOC_FILENAME}`);

// BOM: sem ele o Word abre o HTML como ANSI e quebra os acentos.
writeFileSync(out, "﻿" + renderManualWordHtml(), "utf8");

console.log(`Manual gerado: ${out}`);
