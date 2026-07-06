/**
 * Cliente Amadeus Self-Service API — busca real de voos e hotéis.
 * Ativo quando AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET estão configurados.
 * AMADEUS_ENV=production usa api.amadeus.com; default é o ambiente de teste.
 *
 * Segue o padrão do omie/client.ts: throttle simples + timeout duro via
 * Promise.race (AbortController sozinho já se mostrou não confiável na Vercel).
 */

const REQUEST_INTERVAL_MS = 350;
const HARD_TIMEOUT_MS = 30_000;

let lastRequest = 0;
let cachedToken: { token: string; expiresAt: number } | null = null;

function baseUrl(): string {
  return process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
}

export function amadeusConfigured(): boolean {
  return Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
}

async function throttle(): Promise<void> {
  const wait = lastRequest + REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  await throttle();
  return Promise.race([
    fetch(url, init),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Amadeus timeout after ${HARD_TIMEOUT_MS}ms`)), HARD_TIMEOUT_MS),
    ),
  ]);
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const res = await fetchWithTimeout(`${baseUrl()}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID!,
      client_secret: process.env.AMADEUS_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Amadeus auth failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function amadeusGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();
  const res = await fetchWithTimeout(`${baseUrl()}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Amadeus ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface FlightOffer {
  price: { grandTotal: string; currency: string };
  itineraries: Array<{ duration: string; segments: Array<{ carrierCode: string; number: string }> }>;
}

export interface AmadeusFlightResult {
  totalBrl: number;
  dataIda: string;
  dataVolta: string;
  companhia: string | null;
  raw: unknown;
}

/**
 * Busca o voo mais barato na janela flexível (desloca a viagem inteira em
 * ±janela dias, mantendo a duração). Retorna null se nenhuma data teve oferta.
 */
export async function searchCheapestFlight(params: {
  origemIata: string;
  destinoIata: string;
  dataIda: string;
  dataVolta: string;
  janelaFlexDias: number;
  passageiros: number;
}): Promise<AmadeusFlightResult | null> {
  const shifts: number[] = [0];
  for (let d = 1; d <= Math.min(params.janelaFlexDias, 3); d++) shifts.push(-d, d);

  let best: AmadeusFlightResult | null = null;
  for (const shift of shifts) {
    const ida = shiftDate(params.dataIda, shift);
    const volta = shiftDate(params.dataVolta, shift);
    try {
      const json = await amadeusGet<{ data?: FlightOffer[] }>("/v2/shopping/flight-offers", {
        originLocationCode: params.origemIata,
        destinationLocationCode: params.destinoIata,
        departureDate: ida,
        returnDate: volta,
        adults: String(params.passageiros),
        currencyCode: "BRL",
        max: "5",
      });
      const offer = (json.data ?? [])[0];
      if (!offer) continue;
      const total = Number(offer.price.grandTotal);
      if (!Number.isFinite(total) || total <= 0) continue;
      if (!best || total < best.totalBrl) {
        best = {
          totalBrl: total,
          dataIda: ida,
          dataVolta: volta,
          companhia: offer.itineraries?.[0]?.segments?.[0]?.carrierCode ?? null,
          raw: offer,
        };
      }
    } catch (err) {
      // Uma data sem oferta/erro não derruba a busca — tenta as demais.
      console.warn("[viagens] amadeus flight shift", shift, err instanceof Error ? err.message : err);
    }
  }
  return best;
}

export interface AmadeusHotelResult {
  diariaMediaBrl: number;
  hotelNome: string | null;
  raw: unknown;
}

/** Menor diária entre as ofertas dos primeiros hotéis da cidade. */
export async function searchHotelRate(params: {
  cityCode: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}): Promise<AmadeusHotelResult | null> {
  try {
    const list = await amadeusGet<{ data?: Array<{ hotelId: string }> }>(
      "/v1/reference-data/locations/hotels/by-city",
      { cityCode: params.cityCode, radius: "20", radiusUnit: "KM" },
    );
    const hotelIds = (list.data ?? []).slice(0, 20).map((h) => h.hotelId);
    if (hotelIds.length === 0) return null;

    const offers = await amadeusGet<{
      data?: Array<{
        hotel?: { name?: string };
        offers?: Array<{ price?: { total?: string } }>;
      }>;
    }>("/v3/shopping/hotel-offers", {
      hotelIds: hotelIds.join(","),
      checkInDate: params.checkIn,
      checkOutDate: params.checkOut,
      adults: String(Math.min(params.adults, 2)),
      currency: "BRL",
      bestRateOnly: "true",
    });

    const nights = Math.max(1, daysBetween(params.checkIn, params.checkOut));
    let best: AmadeusHotelResult | null = null;
    for (const h of offers.data ?? []) {
      const total = Number(h.offers?.[0]?.price?.total);
      if (!Number.isFinite(total) || total <= 0) continue;
      const diaria = total / nights;
      if (!best || diaria < best.diariaMediaBrl) {
        best = { diariaMediaBrl: diaria, hotelNome: h.hotel?.name ?? null, raw: h };
      }
    }
    return best;
  } catch (err) {
    console.warn("[viagens] amadeus hotel", err instanceof Error ? err.message : err);
    return null;
  }
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}
