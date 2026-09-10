/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
    // pdfkit le arquivos AFM via fs.readFileSync em runtime — webpack nao deve
    // tentar bundle-lo, senao quebra em producao com "Could not find module".
    serverComponentsExternalPackages: ["pdfkit", "@react-pdf/renderer"],
    // Garante que os arquivos de metricas das fontes Helvetica (e .icc) do pdfkit
    // sejam copiados pra dentro da serverless function no Vercel. Sem isso, qualquer
    // rota que use pdfkit explode com ENOENT na primeira chamada.
    outputFileTracingIncludes: {
      "/api/ctrl/requests/*/pdf": ["./node_modules/pdfkit/js/data/**/*"],
      "/api/export/dre/pdf": ["./node_modules/pdfkit/js/data/**/*"],
      // Graficos do e-mail do relatorio BI: o resvg le o .wasm e as fontes do
      // disco em runtime (mesmo caso do pdfkit acima). Sem estes includes o
      // e-mail sai com os graficos em tabela — o fallback silencioso do
      // one-page-chart-png.ts — em vez das imagens.
      "/api/cron/bi-monthly-autosend": [
        "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
        "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-*-normal.woff2",
      ],
      "/api/bi-validation/**": [
        "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
        "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-*-normal.woff2",
      ],
      "/api/bi-subscriptions/send": [
        "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
        "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-*-normal.woff2",
      ],
    },
  },
};

export default nextConfig;
