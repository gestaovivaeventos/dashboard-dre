// ============================================================================
// Rasterizador SVG -> PNG para os gráficos do e-mail do One Page
// ============================================================================
//
// POR QUÊ PNG: cliente de e-mail não roda JavaScript (adeus recharts) e o
// Gmail REMOVE `<svg>` inline. Imagem raster é o único formato que abre em
// Gmail, Outlook e Apple Mail ao mesmo tempo.
//
// COMO: `@resvg/resvg-wasm` (WASM, não binário nativo). A escolha do WASM
// sobre o `@resvg/resvg-js` é deliberada — o pacote nativo resolve o binário
// por plataforma via optionalDependencies, e o package-lock.json deste repo é
// gerado no Windows; o build linux da Vercel ficaria sem o binário. O WASM é
// um arquivo só, igual em toda plataforma.
//
// FONTE: o resvg WASM não enxerga fontes do sistema — sem `fontBuffers` o
// texto simplesmente não é desenhado (some, sem erro). Carregamos o IBM Plex
// Sans (mesma fonte da tela) do @fontsource. woff2 funciona no resvg.
//
// ARQUIVOS EM RUNTIME: tanto o .wasm quanto os .woff2 são lidos do disco em
// runtime, então precisam ser rastreados para dentro da serverless function
// da Vercel — ver `outputFileTracingIncludes` no next.config.mjs (mesmo
// tratamento que o pdfkit já exigia para os arquivos AFM).
//
// FALHA: TUDO aqui é best-effort e devolve `null` no erro. Este código roda
// no caminho do cron de envio automático do BI; um gráfico que não rasteriza
// não pode derrubar o envio do relatório — o chamador cai no HTML de tabela.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";

type ResvgModule = typeof import("@resvg/resvg-wasm");

let modulePromise: Promise<ResvgModule | null> | null = null;
let fontBuffers: Uint8Array[] | null = null;

/** Candidatos de caminho — cwd da Vercel e do dev local não são os mesmos. */
function resolveAsset(relative: string): string | null {
  const candidates = [
    path.join(process.cwd(), "node_modules", relative),
    path.join(process.cwd(), "..", "node_modules", relative),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

function loadFonts(): Uint8Array[] {
  if (fontBuffers) return fontBuffers;
  const files = [
    "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2",
    "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
  ];
  const buffers: Uint8Array[] = [];
  for (const file of files) {
    const resolved = resolveAsset(file);
    if (!resolved) continue;
    try {
      buffers.push(new Uint8Array(readFileSync(resolved)));
    } catch {
      // fonte ausente: o resvg desenha sem ela (texto some), mas não quebra
    }
  }
  fontBuffers = buffers;
  return buffers;
}

async function getResvg(): Promise<ResvgModule | null> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    try {
      const mod = await import("@resvg/resvg-wasm");
      const wasmPath = resolveAsset("@resvg/resvg-wasm/index_bg.wasm");
      if (!wasmPath) {
        console.error("[one-page-chart-png] index_bg.wasm não encontrado.");
        return null;
      }
      await mod.initWasm(readFileSync(wasmPath));
      return mod;
    } catch (error) {
      // initWasm lança se já foi inicializado neste processo (lambda quente
      // reaproveitando o módulo). Nesse caso o módulo está utilizável.
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already")) {
        try {
          return await import("@resvg/resvg-wasm");
        } catch {
          return null;
        }
      }
      console.error("[one-page-chart-png] Falha ao iniciar o resvg:", message);
      return null;
    }
  })();
  return modulePromise;
}

/**
 * Rasteriza um SVG em PNG.
 *
 * @param svg      markup completo (com width/height no elemento raiz)
 * @param widthCss largura em que a imagem será EXIBIDA no e-mail; o PNG sai
 *                 com o dobro disso para não ficar borrado em tela retina.
 * @returns Buffer do PNG, ou null se a rasterização falhar por qualquer motivo.
 */
export async function svgToPng(svg: string, widthCss: number): Promise<Buffer | null> {
  const mod = await getResvg();
  if (!mod) return null;
  try {
    const resvg = new mod.Resvg(svg, {
      font: {
        fontBuffers: loadFonts(),
        defaultFontFamily: "IBM Plex Sans",
        loadSystemFonts: false,
      },
      fitTo: { mode: "width", value: Math.round(widthCss * 2) },
    });
    return Buffer.from(resvg.render().asPng());
  } catch (error) {
    console.error(
      "[one-page-chart-png] Falha ao rasterizar gráfico:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
