import crypto from "crypto";
import { omieCall } from "@/lib/omie/client";

const ANEXO_URL = "https://app.omie.com.br/api/v1/geral/anexo/";

// A Omie exige o anexo como ZIP em base64, e cMd5 = MD5 da STRING base64 do zip.
// (Confirmado empiricamente: raw falha; md5 do raw/zip falha; md5 do base64 do
// zip funciona. O zip precisa conter o arquivo com o mesmo nome de cNomeArquivo.)

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

// ZIP "stored" (sem compressão) de um único arquivo. Suficiente para o Omie.
function storedZip(name: string, data: Buffer): Buffer {
  const enc = Buffer.from(name, "utf8");
  const crc = crc32(data);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); // local file header signature
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(data.length, 18); // compressed size (stored = same)
  lh.writeUInt32LE(data.length, 22); // uncompressed size
  lh.writeUInt16LE(enc.length, 26); // file name length
  const local = Buffer.concat([lh, enc, data]);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); // central dir header signature
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(data.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(enc.length, 28);
  const central = Buffer.concat([ch, enc]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(central.length, 12); // central dir size
  eocd.writeUInt32LE(local.length, 16); // central dir offset

  return Buffer.concat([local, central, eocd]);
}

export interface OmieAnexo {
  nIdAnexo: number;
  nome: string;
  tipo: string;
}

export type OmieAnexoTabela = "conta-pagar" | "conta-receber";

// Lista os anexos (comprovantes) de um título do Omie. Pagina até o fim.
// Retorna [] quando o título não tem anexos (a Omie devolve notFound).
export async function listarAnexos(
  appKey: string,
  appSecret: string,
  cTabela: OmieAnexoTabela,
  codigoLancamentoOmie: number,
): Promise<OmieAnexo[]> {
  const anexos: OmieAnexo[] = [];
  let pagina = 1;
  let total = 1;
  do {
    const { data, notFound } = await omieCall(ANEXO_URL, "ListarAnexo", appKey, appSecret, {
      nPagina: pagina,
      nRegPorPagina: 50,
      cTabela,
      nId: codigoLancamentoOmie,
    });
    if (notFound) break;
    const lista =
      (data.listaAnexos as Array<Record<string, unknown>> | undefined) ?? [];
    for (const a of lista) {
      anexos.push({
        nIdAnexo: Number(a.nIdAnexo),
        nome: String(a.cNomeArquivo ?? "anexo"),
        tipo: String(a.cTipoArquivo ?? ""),
      });
    }
    total = Number(data.nTotPaginas ?? 1);
    pagina += 1;
  } while (pagina <= total);
  return anexos;
}

// Obtém a URL temporária de download de um anexo específico (ObterAnexo →
// cLinkDownload). A URL expira (dDtExpiracao), então é resolvida sob demanda.
export async function obterAnexoLink(
  appKey: string,
  appSecret: string,
  cTabela: OmieAnexoTabela,
  codigoLancamentoOmie: number,
  nIdAnexo: number,
): Promise<string | null> {
  const { data, notFound } = await omieCall(ANEXO_URL, "ObterAnexo", appKey, appSecret, {
    cTabela,
    nId: codigoLancamentoOmie,
    nIdAnexo,
  });
  if (notFound) return null;
  const link = data.cLinkDownload;
  return typeof link === "string" && link ? link : null;
}

export function listarAnexosContaPagar(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
): Promise<OmieAnexo[]> {
  return listarAnexos(appKey, appSecret, "conta-pagar", codigoLancamentoOmie);
}

export function obterAnexoLinkContaPagar(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
  nIdAnexo: number,
): Promise<string | null> {
  return obterAnexoLink(appKey, appSecret, "conta-pagar", codigoLancamentoOmie, nIdAnexo);
}

// Anexa um arquivo a um título do Omie (conta-pagar ou conta-receber). Lança em
// caso de erro do Omie.
async function incluirAnexo(
  appKey: string,
  appSecret: string,
  cTabela: "conta-pagar" | "conta-receber",
  codigoLancamentoOmie: number,
  fileName: string,
  fileBytes: Buffer,
): Promise<void> {
  const zip = storedZip(fileName, fileBytes);
  const cArquivo = zip.toString("base64");
  const cMd5 = crypto.createHash("md5").update(cArquivo).digest("hex");
  const ext = (fileName.split(".").pop() ?? "").toLowerCase().slice(0, 10);

  await omieCall(ANEXO_URL, "IncluirAnexo", appKey, appSecret, {
    cTabela,
    nId: codigoLancamentoOmie,
    cNomeArquivo: fileName,
    cTipoArquivo: ext,
    cArquivo,
    cMd5,
  });
}

export function incluirAnexoContaPagar(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
  fileName: string,
  fileBytes: Buffer,
): Promise<void> {
  return incluirAnexo(appKey, appSecret, "conta-pagar", codigoLancamentoOmie, fileName, fileBytes);
}

export function incluirAnexoContaReceber(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
  fileName: string,
  fileBytes: Buffer,
): Promise<void> {
  return incluirAnexo(appKey, appSecret, "conta-receber", codigoLancamentoOmie, fileName, fileBytes);
}
