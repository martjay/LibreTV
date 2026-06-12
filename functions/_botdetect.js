import { banIp, getClientIp, getWhitelistIps } from "./_blocklist.js";
import { classifyRequest } from "./_ratelimit.js";

const TRACK_KV_PREFIX = "bot:track:";
const TRACK_CACHE_ORIGIN = "https://bot-track.internal";
const MINUTE_MS = 60 * 1000;
const DEFAULT_WINDOW_MS = 10 * MINUTE_MS;
const DEFAULT_MIN_SPAN_MINUTES = 8;
const DEFAULT_MIN_ACTIVE_MINUTES = 6;
const DEFAULT_MIN_REQUESTS_PER_MINUTE = 2;
const DEFAULT_MAX_COUNT_CV = 0.25;
const DEFAULT_MINUTE_MATCH_RATIO = 0.85;
const DEFAULT_SEARCH_REFRESH_BAN = 10;
const DEFAULT_PLAYER_REFRESH_BAN = 5;
const DEFAULT_REGULAR_SEARCH_BAN = 10;
const DEFAULT_REGULAR_SEARCH_MIN_SPAN = 4;
const DEFAULT_REGULAR_SEARCH_MAX_INTERVAL_CV = 0.35;

function getTrackKv(env) {
  return env?.LIBRETV_BAN_KV || env?.LIBRETV_PROXY_KV || null;
}

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
  const searchRefreshBanCount = parseInt(
    env.BOT_SEARCH_REFRESH_BAN_COUNT || String(DEFAULT_SEARCH_REFRESH_BAN),
    10,
  );
  const playerRefreshBanCount = parseInt(
    env.BOT_PLAYER_REFRESH_BAN_COUNT || String(DEFAULT_PLAYER_REFRESH_BAN),
    10,
  );
  const regularSearchBanCount = parseInt(
    env.BOT_REGULAR_SEARCH_BAN_COUNT || String(DEFAULT_REGULAR_SEARCH_BAN),
    10,
  );
  const regularSearchMinSpanMinutes = parseInt(
    env.BOT_REGULAR_SEARCH_MIN_SPAN_MINUTES || String(DEFAULT_REGULAR_SEARCH_MIN_SPAN),
    10,
  );
  const regularSearchMaxIntervalCv = parseFloat(
    env.BOT_REGULAR_SEARCH_MAX_INTERVAL_CV || String(DEFAULT_REGULAR_SEARCH_MAX_INTERVAL_CV),
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
    searchRefreshBanCount:
      Number.isFinite(searchRefreshBanCount) && searchRefreshBanCount > 0
        ? searchRefreshBanCount
        : DEFAULT_SEARCH_REFRESH_BAN,
    playerRefreshBanCount:
      Number.isFinite(playerRefreshBanCount) && playerRefreshBanCount > 0
        ? playerRefreshBanCount
        : DEFAULT_PLAYER_REFRESH_BAN,
    regularSearchBanCount:
      Number.isFinite(regularSearchBanCount) && regularSearchBanCount > 0
        ? regularSearchBanCount
        : DEFAULT_REGULAR_SEARCH_BAN,
    regularSearchMinSpanMinutes:
      Number.isFinite(regularSearchMinSpanMinutes) && regularSearchMinSpanMinutes > 0
        ? regularSearchMinSpanMinutes
        : DEFAULT_REGULAR_SEARCH_MIN_SPAN,
    regularSearchMaxIntervalCv:
      Number.isFinite(regularSearchMaxIntervalCv) && regularSearchMaxIntervalCv > 0
        ? regularSearchMaxIntervalCv
        : DEFAULT_REGULAR_SEARCH_MAX_INTERVAL_CV,
  };
}

function trackKvKey(ip) {
  return `${TRACK_KV_PREFIX}${ip}`;
}

function trackCacheKey(ip) {
  return new Request(`${TRACK_CACHE_ORIGIN}/${encodeURIComponent(ip)}`);
}

async function readTrackRecordFromKv(kv, ip) {
  const raw = await kv.get(trackKvKey(ip));
  if (!raw) return { events: [] };
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data?.events) ? data : { events: [] };
  } catch {
    return { events: [] };
  }
}

async function writeTrackRecordToKv(kv, ip, record) {
  await kv.put(trackKvKey(ip), JSON.stringify(record));
}

async function readTrackRecordFromCache(cache, ip) {
  const cached = await cache.match(trackCacheKey(ip));
  if (!cached) return { events: [] };
  try {
    const data = await cached.json();
    return Array.isArray(data?.events) ? data : { events: [] };
  } catch {
    return { events: [] };
  }
}

async function writeTrackRecordToCache(cache, ip, record, windowMs) {
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

async function readTrackRecord(ip, env) {
  const kv = getTrackKv(env);
  if (kv) {
    return readTrackRecordFromKv(kv, ip);
  }
  return readTrackRecordFromCache(caches.default, ip);
}

async function writeTrackRecord(ip, record, windowMs, env) {
  const kv = getTrackKv(env);
  if (kv) {
    await writeTrackRecordToKv(kv, ip, record);
  }
  await writeTrackRecordToCache(caches.default, ip, record, windowMs);
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
 * 检测「每分钟固定次数、持续足够长时间」的机器人行为。
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

function getTrailingConsecutiveCount(events, keyMatcher) {
  if (!events.length) return { count: 0, key: null };

  const last = events[events.length - 1];
  if (!keyMatcher(last.q)) return { count: 0, key: null };

  const targetKey = last.q;
  let count = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].q === targetKey && keyMatcher(events[i].q)) {
      count += 1;
    } else {
      break;
    }
  }

  return { count, key: targetKey };
}

/**
 * 检测搜索请求的时间间隔是否规律（关键词可不同）。
 * 取相邻两次 search:wd 之间的时间差，变异系数足够低则视为脚本行为。
 */
function analyzeSearchIntervalPattern(searchEvents, config) {
  if (searchEvents.length < config.regularSearchBanCount) return null;

  const sorted = [...searchEvents.map((entry) => entry.t)].sort((a, b) => a - b);
  const spanMinutes = (sorted[sorted.length - 1] - sorted[0]) / MINUTE_MS;
  if (spanMinutes < config.regularSearchMinSpanMinutes) {
    return null;
  }

  const intervals = [];
  for (let i = 1; i < sorted.length; i += 1) {
    intervals.push(sorted[i] - sorted[i - 1]);
  }
  if (intervals.length < config.regularSearchBanCount - 1) {
    return null;
  }

  const intervalCv = coefficientOfVariation(intervals);
  if (intervalCv > config.regularSearchMaxIntervalCv) {
    return null;
  }

  const meanIntervalSec =
    intervals.reduce((sum, value) => sum + value, 0) / intervals.length / 1000;

  return {
    count: sorted.length,
    spanMinutes: Number(spanMinutes.toFixed(1)),
    meanIntervalSec: Number(meanIntervalSec.toFixed(1)),
    intervalCv: Number(intervalCv.toFixed(3)),
  };
}

function checkImmediateBanRules(events, config) {
  const isSearchPageKey = (key) => key.startsWith("page:search:");
  const isSearchApiKey = (key) => key.startsWith("search:wd:");
  const isPlayerPageKey = (key) => key.startsWith("page:player:");

  const pageSearchStreak = getTrailingConsecutiveCount(events, isSearchPageKey);
  if (pageSearchStreak.count >= config.searchRefreshBanCount) {
    return {
      reason: `搜索结果页连续刷新 ${pageSearchStreak.count} 次（${pageSearchStreak.key}）`,
      rule: "search_page_refresh",
      count: pageSearchStreak.count,
    };
  }

  const playerStreak = getTrailingConsecutiveCount(events, isPlayerPageKey);
  if (playerStreak.count >= config.playerRefreshBanCount) {
    return {
      reason: `播放页连续刷新 ${playerStreak.count} 次（${playerStreak.key}）`,
      rule: "player_page_refresh",
      count: playerStreak.count,
    };
  }

  const searchEvents = events.filter((entry) => isSearchApiKey(entry.q));
  const searchIntervalPattern = analyzeSearchIntervalPattern(searchEvents, config);
  if (searchIntervalPattern) {
    return {
      reason: `规律性搜索 ${searchIntervalPattern.count} 次（关键词不限，间隔约 ${searchIntervalPattern.meanIntervalSec} 秒，持续 ${searchIntervalPattern.spanMinutes} 分钟）`,
      rule: "regular_search_interval",
      count: searchIntervalPattern.count,
      pattern: searchIntervalPattern,
    };
  }

  return null;
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
  const record = await readTrackRecord(ip, env);

  record.events = record.events.filter((entry) => now - entry.t < config.windowMs);
  record.events.push({ t: now, q: classified.key });

  await writeTrackRecord(ip, record, config.windowMs, env);

  const immediateBan = checkImmediateBanRules(record.events, config);
  if (immediateBan) {
    await banIp(ip, "auto", immediateBan.reason, env);
    return { banned: true, ...immediateBan };
  }

  const timestamps = record.events.map((entry) => entry.t);
  const pattern = analyzePerMinutePattern(timestamps, config);
  if (!pattern) {
    return { banned: false };
  }

  const reason = `持续 ${pattern.spanMinutes} 分钟、每分钟约 ${pattern.requestsPerMinute} 次规律性请求（活跃 ${pattern.activeMinutes} 分钟）`;
  await banIp(ip, "auto", reason, env);

  return { banned: true, reason, pattern, rule: "long_term_pattern" };
}
