import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";

import { ContractDoc, type ContractPdfData } from "@/lib/case/contract-doc";

export type { ContractPdfData };

/**
 * Gera o PDF do contrato de venda (CONTRATO DE PRESTAÇÃO DE SERVIÇOS ARTÍSTICOS)
 * renderizando o template CASE Shows (@react-pdf, vetorial — fontes/logo embutidas).
 */
export function buildContractPdf(data: ContractPdfData): Promise<Buffer> {
  const el = React.createElement(ContractDoc, { data }) as React.ReactElement<DocumentProps>;
  return renderToBuffer(el);
}
