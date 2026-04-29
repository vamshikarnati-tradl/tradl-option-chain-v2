const NSE_BASE = 'https://www.nseindia.com';
const HOMEPAGE = `${NSE_BASE}/option-chain`;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

const API_HEADERS: Record<string, string> = {
  ...BROWSER_HEADERS,
  'Accept': 'application/json, text/plain, */*',
  'Referer': HOMEPAGE,
  'X-Requested-With': 'XMLHttpRequest',
};

let cachedCookie: string | null = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 5 * 60 * 1000;

function parseSetCookieHeaders(headers: Headers): string {
  const raw = headers.getSetCookie?.() ?? [];
  const jar: Record<string, string> = {};
  for (const c of raw) {
    const [pair] = c.split(';');
    const [name, ...rest] = pair.split('=');
    if (name && rest.length) jar[name.trim()] = rest.join('=').trim();
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function refreshCookie(): Promise<string> {
  const res = await fetch(HOMEPAGE, { headers: BROWSER_HEADERS, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to fetch NSE homepage for cookie: ${res.status}`);
  }
  await res.text();
  const cookie = parseSetCookieHeaders(res.headers);
  if (!cookie) throw new Error('NSE homepage returned no cookies');
  cachedCookie = cookie;
  cookieFetchedAt = Date.now();
  return cookie;
}

async function getCookie(): Promise<string> {
  if (cachedCookie && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) {
    return cachedCookie;
  }
  return refreshCookie();
}

export interface RawNseChain {
  records: {
    expiryDates: string[];
    underlyingValue: number;
    data: RawNseStrike[];
  };
  filtered: {
    data: RawNseStrike[];
    CE?: { totOI: number; totVol: number };
    PE?: { totOI: number; totVol: number };
  };
}

export interface RawNseStrike {
  strikePrice: number;
  expiryDate: string;
  CE?: RawNseLeg;
  PE?: RawNseLeg;
}

export interface RawNseLeg {
  strikePrice: number;
  expiryDate: string;
  underlying: string;
  identifier: string;
  openInterest: number;
  changeinOpenInterest: number;
  pchangeinOpenInterest: number;
  totalTradedVolume: number;
  impliedVolatility: number;
  lastPrice: number;
  change: number;
  pChange: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  bidQty: number;
  bidprice: number;
  askQty: number;
  askPrice: number;
  underlyingValue: number;
}

export async function fetchOptionChain(symbol: string): Promise<RawNseChain> {
  const url = `${NSE_BASE}/api/option-chain-indices?symbol=${encodeURIComponent(symbol)}`;

  const attempt = async (cookie: string): Promise<Response> => {
    return fetch(url, {
      headers: { ...API_HEADERS, Cookie: cookie },
    });
  };

  let cookie = await getCookie();
  let res = await attempt(cookie);

  if (res.status === 401 || res.status === 403) {
    cookie = await refreshCookie();
    res = await attempt(cookie);
  }

  if (!res.ok) {
    throw new Error(`NSE option-chain fetch failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as RawNseChain;
  if (!json?.records?.data) {
    throw new Error('NSE response missing records.data');
  }
  return json;
}

export async function fetchExpiries(symbol: string): Promise<string[]> {
  const chain = await fetchOptionChain(symbol);
  return chain.records.expiryDates ?? [];
}
