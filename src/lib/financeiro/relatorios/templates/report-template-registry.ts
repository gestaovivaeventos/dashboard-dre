import { franquiasVivaTemplate } from "./franquias-viva-template";
import { genericTemplate } from "./generic-template";
import { realEstateSalvaterraCondominioTemplate } from "./real-estate-salvaterra-condominio-template";
import { realEstateSalvaterraEstacionamentoTemplate } from "./real-estate-salvaterra-estacionamento-template";
import { realEstateSgxTemplate } from "./real-estate-sgx-template";
import { realEstateVillageTemplate } from "./real-estate-village-template";
import type { ReportTemplate, TemplateMatchContext } from "./report-template-types";

// ============================================================================
// Registro de templates do One Page Report.
// ============================================================================
// Ordem = desempate em caso de prioridade igual (primeiro vence). Mais
// específicos (empresa) primeiro; genérico por último (fallback).
// ============================================================================

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  realEstateSgxTemplate,
  realEstateVillageTemplate,
  realEstateSalvaterraEstacionamentoTemplate,
  realEstateSalvaterraCondominioTemplate,
  franquiasVivaTemplate,
  genericTemplate,
];

export interface ResolveTemplateInput {
  companyId: string;
  companyName: string;
  segmentSlug: string | null;
}

/**
 * Resolve o template de relatório para uma empresa. Escolhe o de MAIOR
 * prioridade entre os que casam (matches). Como o genérico casa sempre com
 * prioridade 0, há sempre um resultado — nunca lança.
 */
export function resolveReportTemplate(input: ResolveTemplateInput): ReportTemplate {
  const ctx: TemplateMatchContext = {
    companyId: input.companyId,
    companyName: input.companyName ?? "",
    companyNameLower: (input.companyName ?? "").trim().toLowerCase(),
    segmentSlug: input.segmentSlug,
  };

  let best: ReportTemplate | null = null;
  for (const template of REPORT_TEMPLATES) {
    if (!template.matches(ctx)) continue;
    if (best === null || template.priority > best.priority) {
      best = template;
    }
  }
  return best ?? genericTemplate;
}

export { genericTemplate, franquiasVivaTemplate };
