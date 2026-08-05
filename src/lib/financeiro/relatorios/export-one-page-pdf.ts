// ============================================================================
// Export do One Page Report em PDF — captura do DOM já renderizado.
//
// Usado por DUAS telas: Business Intelligence e Validação Relatório. As duas
// exibem o MESMO componente (<OnePageReportPreview />) alimentado pelo MESMO
// mapper, então o PDF sai idêntico nas duas — é justamente por isso que a
// captura vive aqui e não duplicada em cada tela.
//
// Como funciona: html2canvas fotografa a folha branca (.one-page-report) em
// alta resolução (scale=2) e jsPDF embute a imagem em UMA página com a largura
// de um A4 e a altura proporcional ao conteúdo — sem quebra de página e sem
// distorção. As bibliotecas são carregadas DINAMICAMENTE: ficam fora do bundle
// inicial e só chegam ao navegador no clique (~250kb gz + ~1-2s de render).
//
// Só roda no browser (usa document/DOM).
// ============================================================================

/** Remove do nome do arquivo os caracteres que o Windows/macOS recusam. */
export function sanitizePdfFilename(value: string): string {
  return value.replace(/[/\\?%*:|"<>\s]+/g, "_").replace(/_+/g, "_");
}

export interface ExportOnePagePdfArgs {
  /** Elemento que ENVOLVE o relatório (a folha `.one-page-report` é buscada dentro). */
  container: HTMLElement;
  /** Empresa e período — compõem o nome do arquivo. */
  empresa: string;
  periodo: string;
}

/**
 * Gera e baixa o PDF do relatório renderizado em `container`.
 * Devolve o nome do arquivo salvo. Lança em qualquer falha — quem chama
 * decide como avisar o usuário.
 */
export async function exportOnePageReportPdf({
  container,
  empresa,
  periodo,
}: ExportOnePagePdfArgs): Promise<string> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  // Captura apenas a FOLHA branca (.one-page-report), nao o fundo cinza
  // "de mesa" (.opr-page) que existe so para a previa na tela — assim o PDF
  // sai como folha branca limpa, sem a moldura cinza ao redor.
  const captureTarget =
    container.querySelector<HTMLElement>(".one-page-report") ?? container;

  const canvas = await html2canvas(captureTarget, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    // `onclone` roda no DOM clonado que o html2canvas usa para captura.
    // Forca `overflow: visible` em wrappers do recharts e SVGs internos —
    // sem isso os LabelList posicionados fora do plot area (position
    // "right" nas barras horizontais e "top" nas barras verticais) sao
    // clipados e nao aparecem no PDF.
    onclone: (clonedDoc) => {
      const selectors = [
        ".recharts-wrapper",
        ".recharts-surface",
        ".recharts-responsive-container",
        "svg",
      ];
      clonedDoc
        .querySelectorAll<HTMLElement | SVGElement>(selectors.join(","))
        .forEach((el) => {
          (el as HTMLElement).style.overflow = "visible";
          if ("setAttribute" in el) {
            el.setAttribute("overflow", "visible");
          }
        });
      // Elementos interativos (ex.: botão de exportar planilha) não fazem
      // parte do documento impresso — remove-os do clone capturado.
      clonedDoc.querySelectorAll<HTMLElement>("[data-export-hide]").forEach((el) => {
        el.style.display = "none";
      });
      // Folha branca plana no PDF: remove sombra, cantos arredondados e
      // margem do card (a moldura cinza vem do pai, que nao e capturado).
      const art = clonedDoc.querySelector<HTMLElement>(".one-page-report");
      if (art) {
        art.style.boxShadow = "none";
        art.style.borderRadius = "0";
        art.style.margin = "0";
      }
    },
  });

  const imgData = canvas.toDataURL("image/png");

  // Página com o formato EXATO do relatório: largura fixa de 210 mm (A4
  // retrato) e altura proporcional ao conteúdo. Assim o relatório preenche a
  // folha inteira na largura — sem margens laterais sobrando — e sai em UMA
  // única página, sem distorção.
  const pageWidth = 210;
  const pageHeight = Math.max(1, Math.round((canvas.height / canvas.width) * pageWidth));
  const pdf = new jsPDF({
    orientation: pageHeight >= pageWidth ? "portrait" : "landscape",
    unit: "mm",
    format: [pageWidth, pageHeight],
    compress: true,
  });
  pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);

  const filename = sanitizePdfFilename(`OnePageReport_${empresa}_${periodo}.pdf`);
  pdf.save(filename);
  return filename;
}
