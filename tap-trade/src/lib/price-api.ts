import type { PricePoint, TokenConfig } from "./types";

const BASE = "/xstocks";

/**
 * Fetch the latest price for one token from the xStocks (Backed) API.
 * Public endpoint, no auth required.
 */
export async function fetchQuote(
  token: TokenConfig
): Promise<{ price: number; timestamp: string } | null> {
  try {
    const res = await fetch(
      `${BASE}/collateral/quote?symbol=${token.ticker}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.quote ?? data?.[token.ticker]?.quote;
    const timestamp = data?.timestamp ?? data?.[token.ticker]?.timestamp;
    if (price == null || !isFinite(price)) return null;
    return { price: Math.round(price * 100) / 100, timestamp };
  } catch {
    return null;
  }
}

/**
 * Fetch prices for multiple tokens in a single request.
 */
export async function fetchQuotes(
  tokens: TokenConfig[]
): Promise<Record<string, number> | null> {
  try {
    const symbols = tokens.map((t) => t.ticker).join(",");
    const res = await fetch(`${BASE}/collateral/quote?symbol=${symbols}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const out: Record<string, number> = {};
    for (const [sym, info] of Object.entries(
      data as Record<string, { quote: number }>
    )) {
      if (info?.quote != null) {
        out[sym] = Math.round(info.quote * 100) / 100;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}
