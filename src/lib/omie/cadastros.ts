import { omieCall } from "@/lib/omie/client";

const CATEGORIAS_URL = "https://app.omie.com.br/api/v1/geral/categorias/";
const DEPARTAMENTOS_URL = "https://app.omie.com.br/api/v1/geral/departamentos/";
const CONTAS_URL = "https://app.omie.com.br/api/v1/geral/contacorrente/";

export interface OmieOption {
  codigo: string;
  descricao: string;
  tipo?: string; // só para conta corrente (tipo_conta_corrente)
}

// Pagina uma chamada de listagem do Omie até a última página.
async function paginate(
  url: string,
  call: string,
  appKey: string,
  appSecret: string,
  baseParam: Record<string, unknown>,
  arrayKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapFn: (item: any) => OmieOption | null,
): Promise<OmieOption[]> {
  const out: OmieOption[] = [];
  let pagina = 1;
  let total = 1;
  do {
    const { data, notFound } = await omieCall(url, call, appKey, appSecret, {
      ...baseParam,
      pagina,
      registros_por_pagina: 500,
    });
    if (notFound) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (data[arrayKey] as any[] | undefined) ?? [];
    for (const it of arr) {
      const m = mapFn(it);
      if (m && m.codigo) out.push(m);
    }
    total = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= total);
  return out;
}

export async function listCategorias(appKey: string, appSecret: string): Promise<OmieOption[]> {
  return paginate(
    CATEGORIAS_URL, "ListarCategorias", appKey, appSecret,
    { filtrar_apenas_ativo: "S" }, "categoria_cadastro",
    (it) =>
      it.totalizadora === "S" || it.conta_inativa === "S"
        ? null
        : { codigo: String(it.codigo ?? ""), descricao: String(it.descricao ?? "") },
  );
}

export async function listDepartamentos(appKey: string, appSecret: string): Promise<OmieOption[]> {
  return paginate(
    DEPARTAMENTOS_URL, "ListarDepartamentos", appKey, appSecret,
    {}, "departamentos",
    (it) =>
      it.inativo === "S"
        ? null
        : { codigo: String(it.codigo ?? ""), descricao: String(it.descricao ?? "") },
  );
}

export async function listContasCorrentes(appKey: string, appSecret: string): Promise<OmieOption[]> {
  return paginate(
    // ListarResumoContasCorrentes devolve o array `conta_corrente_lista`
    // (a ListarContasCorrentes "completa" usa a chave `ListarContasCorrentes`).
    CONTAS_URL, "ListarResumoContasCorrentes", appKey, appSecret,
    { filtrar_apenas_ativo: "S" }, "conta_corrente_lista",
    (it) => ({
      codigo: String(it.nCodCC ?? ""),
      descricao: String(it.descricao ?? ""),
      tipo: String(it.tipo_conta_corrente ?? ""),
    }),
  );
}
