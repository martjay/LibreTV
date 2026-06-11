import { banIp, getClientIp, getWhitelistIps } from "./_blocklist.js";
import { classifyRequest } from "./_ratelimit.js";

const TRACK_CACHE_ORIGIN = "https://bot-track.internal";
const DEFAULT_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_MIN_EVENTS = 18;
const DEFAULT_MIN_SPAN_MS = 25 * 60 * 1000;
const DEFAULT_MAX_CV = 0.35;
const DEFAULT_MIN_INTERVAL_MS = 3000;
const DEFAULT_MAX_INTERVAL_MS = 120000;

function getBotDetectConfig(env) {
  const windowMs = parseInt(env.BOT_DETECT_WINDOW_MS || String(DEFAULT_WINDOW_MS), 10);
  const minEvents = parseInt(env.BOT_DETECT_MIN_EVENTS || String(DEFAULT_MIN_EVENTS), 10);
  const minSpanMs = parseInt(env.BOT_DETECT_MIN_SPAN_MS || String(DEFAULT_MIN_SPAN_MS), 10);
  const maxCv = parseFloat(env.BOT_DETECT_MAX_CV || String(DEFAULT_MAX_CV));
  const minIntervalMs = parseInt(
    env.BOT_DETECT_MIN_INTERVAL_MS || String(DEFAULT_MIN_INTERVAL_MS),
    10,
  );
  const maxIntervalMs = parseInt(
    env.BOT_DETECT_MAX_INTERVAL_MS || String(DEFAULT_MAX_INTERVAL_MS),
    10,
  );

  return {
    windowMs:
      Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS,
    minEvents:
      Number.isFinite(minEvents) && minEvents > 0 ? minEvents : DEFAULT_MIN_EVENTS,
    minSpanMs:
      Number.isFinite(minSpanMs) && minSpanMs > 0 ? minSpanMs : DEFAULT_MIN_SPAN_MS,
    maxCv: Number.isFinite(maxCv) && maxCv > 0 ? maxCv : DEFAULT_MAX_CV,
    minIntervalMs:
      Number.isFinite(minIntervalMs) && minIntervalMs > 0
        ? minIntervalMs
        : DEFAULT_MIN_INTERVAL_MS,
    maxIntervalMs:
      Number.isFinite(maxIntervalMs) && maxIntervalMs > 0
        ? maxIntervalMs
        : DEFAULT_MAX_INTERVAL_MS,
  };
}

function trackCacheKey(ip) {
  return new Request(`${TRACK_CACHE_ORIGIN}/${encodeURIComponent(ip)}`);
}

async function readTrackRecord(cache, ip) {
  const cached = await cache.match(trackCacheKey(ip));
  if (!cached) return { events: [] };
  try {
    const data = await cached.json();
    return Array.isArray(data?.events) ? data : { events: [] };
  } catch {
    return { events: [] };
  }
}

async function writeTrackRecord(cache, ip, record, windowMs) {
  await cache.put(
    trackCacheKey(ip),
    new Response(JSON.stringify(record), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${Math.ceil(windowMs / 1000)}`,
      },
    }),
  );
}

export function analyzeRhythmicPattern(timestamps, config) {
  if (timestamps.length < config.minEvents) {
    return null;
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const span = sorted[sorted.length - 1] - sorted[0];
  if (span < config.minSpanMs) {
    return null;
  }

  const intervals = [];
  for (let i = 1; i < sorted.length; i += 1) {
    intervals.push(sorted[i] - sorted[i - 1]);
  }

  if (intervals.length < config.minEvents - 1) {
    return null;
  }

  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  if (mean < config.minIntervalMs || mean > config.maxIntervalMs) {
    return null;
  }

  const variance =
    intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : Number.POSITIVE_INFINITY;

  if (cv > config.maxCv) {
    return null;
  }

  return {
    count: sorted.length,
    spanMs: span,
    meanIntervalMs: Math.round(mean),
    cv: Number(cv.toFixed(3)),
  };
}

export async function trackAndCheckBot(request, env) {
  const ip = getClientIp(request);
  if (!ip || getWhitelistIps(env).has(ip)) {
    return { banned: false };
  }

  const classified = classifyRequest(request);
  if (!classified) {
    return { banned: false };
  }

  const config = getBotDetectConfig(env);
  const now = Date.now();
  const cache = caches.default;
  const record = await readTrackRecord(cache, ip);

  record.events = record.events.filter((entry) => now - entry.t < config.windowMs);
  record.events.push({ t: now, q: classified.key });

  await writeTrackRecord(cache, ip, record, config.windowMs);

  const timestamps = record.events.map((entry) => entry.t);
  const pattern = analyzeRhythmicPattern(timestamps, config);
  if (!pattern) {
    return { banned: false };
  }

  const reason = `半小时内 ${pattern.count} 次规律性访问（间隔约 ${Math.round(pattern.meanIntervalMs / 1000)} 秒，CV=${pattern.cv}）`;
  await banIp(ip, "auto", reason, env);

  return { banned: true, reason, pattern };
}
