/**
 * Cliente da API de Voos (apidevoos.dev, consolida LATAM/GOL/Azul via Moblix).
 * Busca REST em tempo real com preço real e link de compra.
 * Ativo quando APIDEVOOS_API_KEY está configurada.
 *
 * Nota: a resposta real difere da doc — o preço confiável do ida-e-volta fica
 * em flightGroups[].offers[].price.total (total da reserva para os passageiros
 * pedidos); itineraries[].price nem sempre existe.
 */

const BASE_URL = "https://app.apidevoos.dev/api/v1";
const HARD_TIMEOUT_MS = 90_000;

export function apidevoosConfigured(): boolean {
  return Boolean(process.env.APIDEVOOS_API_KEY);
}

interface ApidevoosOffer {
  providerId?: string;
  price?: { total?: number; currency?: string };
  booking?: { bookingUrl?: string };
}

interface ApidevoosGroup {
  humanSignature?: string;
  flightInfo?: {
    itineraries?: Array<{
      type?: string;
      stops?: number;
      segments?: Array<{ marketingCarrier?: { code?: string; name?: string } }>;
    }>;
  };
  offers?: ApidevoosOffer[];
}

export interface ApidevoosFlightResult {
  totalGrupo: number;
  companhia: string | null;
  bookingUrl: string | null;
  provider: string | null;
  stops: number | null;
  assinatura: string | null;
}

/** Menor oferta ida-e-volta para a rota/datas. Null se nada encontrado ou erro. */
export async function searchApidevoosRoundTrip(params: {
  origemIata: string;
  destinoIata: string;
  dataIda: string;
  dataVolta: string;
  passageiros: number;
}): Promise<ApidevoosFlightResult | null> {
  const apiKey = process.env.APIDEVOOS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await Promise.race([
      fetch(`${BASE_URL}/flights/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "round_trip",
          slices: [
            { origin: params.origemIata, destination: params.destinoIata, departureDate: params.dataIda },
            { origin: params.destinoIata, destination: params.origemIata, departureDate: params.dataVolta },
          ],
          passengers: [{ type: "adult", count: Math.max(1, params.passageiros) }],
          cabinClass: "economy",
          searchType: "pagante",
          enableDeduplication: true,
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`apidevoos timeout after ${HARD_TIMEOUT_MS}ms`)), HARD_TIMEOUT_MS),
      ),
    ]);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`apidevoos ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { flightGroups?: ApidevoosGroup[] };
    const groups = json.flightGroups ?? [];

    let best: ApidevoosFlightResult | null = null;
    for (const g of groups) {
      for (const offer of g.offers ?? []) {
        const total = Number(offer.price?.total);
        if (!Number.isFinite(total) || total <= 0) continue;
        if (best && total >= best.totalGrupo) continue;
        const itin = g.flightInfo?.itineraries?.[0];
        best = {
          totalGrupo: total,
          companhia: itin?.segments?.[0]?.marketingCarrier?.name ?? offer.providerId ?? null,
          bookingUrl: sanitizeUrl(offer.booking?.bookingUrl),
          provider: offer.providerId ?? null,
          stops: itin?.stops ?? null,
          assinatura: g.humanSignature ?? null,
        };
      }
    }
    return best;
  } catch (err) {
    console.warn(
      `[viagens] apidevoos ${params.origemIata}→${params.destinoIata}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Só http(s) — o bookingUrl vira link na UI. */
function sanitizeUrl(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:" ? u : null;
  } catch {
    return null;
  }
}
