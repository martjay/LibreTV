import { getClientIp } from "./_blocklist.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60 * 1000;
const CACHE_ORIGIN = "https://rate-limit.internal";

export function getSearchRateLimit(env) {
  const limit = parseInt(env.SEARCH_RATE_LIMIT || String(DEFAULT_LIMIT), 10);
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
}

export function getSearchRateWindowMs(env) {
  const seconds = parseInt(env.SEARCH_RATE_WINDOW_SECONDS || "60", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_WINDOW_MS;
}

function getTargetUrlFromProxyPath(pathname) {
  const encoded = pathname.replace(/^\/proxy\//, "");
  if (!encoded) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.match(/^https?:\/\//i) ? decoded : null;
  } catch {
    return null;
  }
}

export function isSearchProxyRequest(pathname) {
  const targetUrl = getTargetUrlFromProxyPath(pathname);
  if (!targetUrl) return false;

  const lower = targetUrl.toLowerCase();
  if (lower.includes("ac=videolist") && lower.includes("wd=")) {
    return true;
  }
  if (
    lower.includes("douban.com") &&
    (lower.includes("search_subjects") || lower.includes("search_tags"))
  ) {
    return true;
  }
  return false;
}

export function extractSearchKey(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const wd = url.searchParams.get("wd");
    if (wd) return `wd:${wd.toLowerCase()}`;

    if (targetUrl.toLowerCase().includes("douban.com")) {
      const tag = url.searchParams.get("tag") || "";
      const type = url.searchParams.get("type") || "";
      return `douban:${type}:${tag.toLowerCase()}`;
    }
  } catch {
    // ignore
  }
  return targetUrl.toLowerCase();
}

async function readRecord(cache, cacheKey) {
  const cached = await cache.match(cacheKey);
  if (!cached) return { queries: [] };
  try {
    const data = await cached.json();
    return Array.isArray(data?.queries) ? data : { queries: [] };
  } catch {
    return { queries: [] };
  }
}

async function writeRecord(cache, cacheKey, record, windowMs) {
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(record), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${Math.ceil(windowMs / 1000)}`,
      },
    }),
  );
}

export async function checkSearchRateLimit(request, env) {
  const ip = getClientIp(request);
  if (!ip) return { exceeded: false };

  const pathname = new URL(request.url).pathname;
  if (!isSearchProxyRequest(pathname)) return { exceeded: false };

  const targetUrl = getTargetUrlFromProxyPath(pathname);
  const searchKey = extractSearchKey(targetUrl);
  const windowMs = getSearchRateWindowMs(env);
  const limit = getSearchRateLimit(env);
  const now = Date.now();

  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_ORIGIN}/search/${encodeURIComponent(ip)}`);
  const record = await readRecord(cache, cacheKey);

  record.queries = record.queries.filter((entry) => now - entry.t < windowMs);

  const alreadyCounted = record.queries.some((entry) => entry.q === searchKey);
  if (!alreadyCounted) {
    record.queries.push({ q: searchKey, t: now });
  }

  await writeRecord(cache, cacheKey, record, windowMs);

  return {
    exceeded: record.queries.length > limit,
    count: record.queries.length,
    limit,
  };
}

export async function clearSearchRateLimit(request) {
  const ip = getClientIp(request);
  if (!ip) return;

  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_ORIGIN}/search/${encodeURIComponent(ip)}`);
  await cache.delete(cacheKey);
}

export function searchRateLimitResponse(clearCookieHeader) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  };
  if (clearCookieHeader) {
    headers["Set-Cookie"] = clearCookieHeader;
  }

  return new Response(
    JSON.stringify({
      error: "搜索过于频繁，请重新完成人机验证",
      requireTurnstile: true,
    }),
    { status: 429, headers },
  );
}
