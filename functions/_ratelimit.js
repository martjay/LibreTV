import { getClientIp } from "./_blocklist.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_MS = 60 * 1000;
const CACHE_ORIGIN = "https://rate-limit.internal";

export function getAccessRateLimit(env) {
  const raw = env.ACCESS_RATE_LIMIT || env.SEARCH_RATE_LIMIT || String(DEFAULT_LIMIT);
  const limit = parseInt(raw, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
}

export function getAccessRateWindowMs(env) {
  const raw = env.ACCESS_RATE_WINDOW_SECONDS || env.SEARCH_RATE_WINDOW_SECONDS || "60";
  const seconds = parseInt(raw, 10);
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

function extractSearchKey(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const wd = url.searchParams.get("wd");
    if (wd) return `search:wd:${wd.toLowerCase()}`;
  } catch {
    // ignore
  }
  return null;
}

function extractDetailKey(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const ids = url.searchParams.get("ids");
    if (ids) return `detail:ids:${ids}`;
  } catch {
    // ignore
  }
  return null;
}

function extractM3u8Key(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return `play:${url.origin}${url.pathname}`.toLowerCase();
  } catch {
    return `play:${targetUrl.split("?")[0].toLowerCase()}`;
  }
}

function extractDoubanKey(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const tag = url.searchParams.get("tag") || "";
    const type = url.searchParams.get("type") || "";
    return `douban:${type}:${tag.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function classifyProxyRequest(pathname) {
  const targetUrl = getTargetUrlFromProxyPath(pathname);
  if (!targetUrl) return null;

  const lower = targetUrl.toLowerCase();

  if (/\.(ts|mp4|key|jpg|jpeg|png|gif|webp|ico|svg)(\?|$|#)/i.test(lower)) {
    return null;
  }

  if (lower.includes("ac=videolist") && lower.includes("wd=")) {
    const key = extractSearchKey(targetUrl);
    return key ? { key } : null;
  }

  if (lower.includes("ac=videolist") && lower.includes("ids=")) {
    const key = extractDetailKey(targetUrl);
    return key ? { key } : null;
  }

  if (lower.includes("/detail/") || lower.includes("/vod/detail/")) {
    try {
      const parsed = new URL(targetUrl);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1] || "";
      const id = last.replace(/\.html$/i, "");
      if (id && id !== "detail" && id !== "vod") {
        return { key: `detail:html:${id}`.slice(0, 240) };
      }
    } catch {
      // ignore
    }
  }

  if (lower.includes(".m3u8")) {
    return { key: extractM3u8Key(targetUrl) };
  }

  if (
    lower.includes("douban.com") &&
    (lower.includes("search_subjects") || lower.includes("search_tags"))
  ) {
    const key = extractDoubanKey(targetUrl);
    return key ? { key } : null;
  }

  return null;
}

export function classifyPageRequest(url) {
  const path = url.pathname.toLowerCase();

  if (path === "/player.html" || path.endsWith("/player.html")) {
    const id = url.searchParams.get("id") || url.searchParams.get("url") || "";
    const source = url.searchParams.get("source") || url.searchParams.get("source_code") || "";
    if (!id) return null;
    return { key: `page:player:${source}:${id}`.slice(0, 240) };
  }

  if (path === "/watch.html" || path.endsWith("/watch.html")) {
    const id = url.searchParams.get("id") || url.searchParams.get("url") || "";
    if (!id) return null;
    return { key: `page:watch:${id}`.slice(0, 240) };
  }

  return null;
}

function classifyRequest(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/proxy/")) {
    return classifyProxyRequest(url.pathname);
  }
  return classifyPageRequest(url);
}

async function readRecord(cache, cacheKey) {
  const cached = await cache.match(cacheKey);
  if (!cached) return { actions: [] };
  try {
    const data = await cached.json();
    return Array.isArray(data?.actions) ? data : { actions: [] };
  } catch {
    return { actions: [] };
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

export async function checkAccessRateLimit(request, env) {
  const ip = getClientIp(request);
  if (!ip) return { exceeded: false };

  const classified = classifyRequest(request);
  if (!classified) return { exceeded: false };

  const windowMs = getAccessRateWindowMs(env);
  const limit = getAccessRateLimit(env);
  const now = Date.now();

  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_ORIGIN}/access/${encodeURIComponent(ip)}`);
  const record = await readRecord(cache, cacheKey);

  record.actions = record.actions.filter((entry) => now - entry.t < windowMs);

  const alreadyCounted = record.actions.some((entry) => entry.q === classified.key);
  if (!alreadyCounted) {
    record.actions.push({ q: classified.key, t: now });
  }

  await writeRecord(cache, cacheKey, record, windowMs);

  return {
    exceeded: record.actions.length > limit,
    count: record.actions.length,
    limit,
  };
}

export async function clearAccessRateLimit(request) {
  const ip = getClientIp(request);
  if (!ip) return;

  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_ORIGIN}/access/${encodeURIComponent(ip)}`);
  await cache.delete(cacheKey);
}

export const clearSearchRateLimit = clearAccessRateLimit;
export const checkSearchRateLimit = checkAccessRateLimit;

export function rateLimitResponse(clearCookieHeader) {
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
      error: "访问过于频繁，请重新完成人机验证",
      requireTurnstile: true,
    }),
    { status: 429, headers },
  );
}

export const searchRateLimitResponse = rateLimitResponse;
