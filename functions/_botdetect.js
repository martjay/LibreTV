import { banIp, getClientIp, getWhitelistIps } from "./_blocklist.js";
import { classifyRequest } from "./_ratelimit.js";

const TRACK_CACHE_ORIGIN = "https://bot-track.internal";
const MINUTE_MS = 60 * 1000;
const DEFAULT_WINDOW_MS = 30 * MINUTE_MS;
const DEFAULT_MIN_SPAN_MINUTES = 29;
const DEFAULT_MIN_ACTIVE_MINUTES = 28;
const DEFAULT_MIN_REQUESTS_PER_MINUTE = 2;
const DEFAULT_MAX_COUNT_CV = 0.2;
const DEFAULT_MINUTE_MATCH_RATIO = 0.85;

function getBotDetectConfig(env) {
  const windowMs = parseInt(env.BOT_DETECT_WINDOW_MS || String(DEFAULT_WINDOW_MS), 10);
  const minSpanMinutes = parseInt(
    env.BOT_DETECT_MIN_SPAN_MINUTES || String(DEFAULT_MIN_SPAN_MINUTES),
    10,
  );
  const minActiveMinutes = parseInt(
    env.BOT_DETECT_MIN_ACTIVE_MINUTES || String(DEFAULT_MIN_ACTIVE_MINUTES),
    10,
  );
  const minRequestsPerMinute = parseInt(
    env.BOT_DETECT_MIN_REQUESTS_PER_MINUTE || String(DEFAULT_MIN_REQUESTS_PER_MINUTE),
    10,
  );
  const maxCountCv = parseFloat(
    env.BOT_DETECT_MAX_COUNT_CV || env.BOT_DETECT_MAX_CV || String(DEFAULT_MAX_COUNT_CV),
  );
  const minuteMatchRatio = parseFloat(
    env.BOT_DETECT_MINUTE_MATCH_RATIO || String(DEFAULT_MINUTE_MATCH_RATIO),
  );

  return {
    windowMs:
      Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS,
    minSpanMinutes:
      Number.isFinite(minSpanMinutes) && minSpanMinutes > 0
        ? minSpanMinutes
        : DEFAULT_MIN_SPAN_MINUTES,
    minActiveMinutes:
      Number.isFinite(minActiveMinutes) && minActiveMinutes > 0
        ? minActiveMinutes
        : DEFAULT_MIN_ACTIVE_MINUTES,
    minRequestsPerMinute:
      Number.isFinite(minRequestsPerMinute) && minRequestsPerMinute > 0
        ? minRequestsPerMinute
        : DEFAULT_MIN_REQUESTS_PER_MINUTE,
    maxCountCv:
      Number.isFinite(maxCountCv) && maxCountCv > 0 ? maxCountCv : DEFAULT_MAX_COUNT_CV,
    minuteMatchRatio:
      Number.isFinite(minuteMatchRatio) && minuteMatchRatio > 0
        ? minuteMatchRatio
        : DEFAULT_MINUTE_MATCH_RATIO,
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

function bucketCountsByMinute(timestamps) {
  const buckets = new Map();
  for (const t of timestamps) {
    const minute = Math.floor(t / MINUTE_MS);
    buckets.set(minute, (buckets.get(minute) || 0) + 1);
  }
  return buckets;
}

function getModeCount(counts) {
  const freq = new Map();
  for (const count of counts) {
    freq.set(count, (freq.get(count) || 0) + 1);
  }

  let mode = counts[0];
  let maxFreq = 0;
  for (const [count, times] of freq.entries()) {
    if (times > maxFreq) {
      maxFreq = times;
      mode = count;
    }
  }
  return mode;
}

function coefficientOfVariation(values) {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return Number.POSITIVE_INFINITY;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * 检测「每分钟固定次数、持续约 30 分钟」的机器人行为。
 * 按自然分钟分桶，要求跨度足够长、绝大多数分钟都有请求，且每分钟次数高度一致。
 */
export function analyzePerMinutePattern(timestamps, config) {
  if (timestamps.length < config.minActiveMinutes * config.minRequestsPerMinute) {
    return null;
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const spanMs = sorted[sorted.length - 1] - sorted[0];
  const spanMinutes = spanMs / MINUTE_MS;
  if (spanMinutes < config.minSpanMinutes) {
    return null;
  }

  const buckets = bucketCountsByMinute(sorted);
  const minuteKeys = [...buckets.keys()].sort((a, b) => a - b);
  const firstMinute = minuteKeys[0];
  const lastMinute = minuteKeys[minuteKeys.length - 1];
  const slotCount = lastMinute - firstMinute + 1;

  const perMinuteCounts = [];
  for (let minute = firstMinute; minute <= lastMinute; minute += 1) {
    perMinuteCounts.push(buckets.get(minute) || 0);
  }

  const activeCounts = perMinuteCounts.filter((count) => count > 0);
  if (activeCounts.length < config.minActiveMinutes) {
    return null;
  }

  const meanPerMinute =
    activeCounts.reduce((sum, value) => sum + value, 0) / activeCounts.length;
  if (meanPerMinute < config.minRequestsPerMinute) {
    return null;
  }

  const countCv = coefficientOfVariation(activeCounts);
  if (countCv > config.maxCountCv) {
    return null;
  }

  const modeCount = getModeCount(activeCounts);
  const matchedMinutes = activeCounts.filter(
    (count) => Math.abs(count - modeCount) <= 1,
  ).length;
  const matchRatio = matchedMinutes / activeCounts.length;
  if (matchRatio < config.minuteMatchRatio) {
    return null;
  }

  return {
    spanMinutes: Number(spanMinutes.toFixed(1)),
    activeMinutes: activeCounts.length,
    requestsPerMinute: modeCount,
    meanPerMinute: Number(meanPerMinute.toFixed(2)),
    countCv: Number(countCv.toFixed(3)),
    matchRatio: Number(matchRatio.toFixed(3)),
    totalRequests: sorted.length,
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
  const pattern = analyzePerMinutePattern(timestamps, config);
  if (!pattern) {
    return { banned: false };
  }

  const reason = `持续 ${pattern.spanMinutes} 分钟、每分钟约 ${pattern.requestsPerMinute} 次规律性请求（活跃 ${pattern.activeMinutes} 分钟）`;
  await banIp(ip, "auto", reason, env);

  return { banned: true, reason, pattern };
}
