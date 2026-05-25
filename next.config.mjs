/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
    // pdfkit le arquivos AFM via fs.readFileSync em runtime — webpack nao deve
    // tentar bundle-lo, senao quebra em producao com "Could not find module".
    serverComponentsExternalPackages: ["pdfkit"],
    // Garante que os arquivos de metricas das fontes Helvetica (e .icc) do pdfkit
    // sejam copiados pra dentro da serverless function no Vercel. Sem isso, qualquer
    // rota que use pdfkit explode com ENOENT na primeira chamada.
    outputFileTracingIncludes: {
      "/api/ctrl/requests/*/pdf": ["./node_modules/pdfkit/js/data/**/*"],
      "/api/export/dre/pdf": ["./node_modules/pdfkit/js/data/**/*"],
    },
  },
};

export default nextConfig;
