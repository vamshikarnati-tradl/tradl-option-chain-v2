// HTTP client for the option-chain backend. Pure fetch wrappers — TanStack
// Query owns caching/lifecycle in the hooks that call these.

export interface ExpiryResp {
  symbol: string;
  expiries: string[];
}

export async function fetchExpiries(symbol: string, signal?: AbortSignal): Promise<ExpiryResp> {
  const res = await fetch(`/api/expiries/${symbol}`, { signal });
  if (!res.ok) throw new Error(`expiries ${symbol}: ${res.status} ${res.statusText}`);
  return (await res.json()) as ExpiryResp;
}
