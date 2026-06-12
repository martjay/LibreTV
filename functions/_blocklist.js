const DEFAULT_BLOCKED_IPS = [
  "35.221.244.169",
  "35.234.63.228",
  "195.178.110.104",
];

const BAN_CACHE_ORIGIN = "https://ban.internal";
const BAN_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const BAN_KV_RECORD_PREFIX = "ban:record:";
const BAN_KV_INDEX_KEY = "ban:index";

export function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Real-IP") ||
    ""
  );
}

function isValidIp(ip) {
  if (!ip || ip.length > 45) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[\da-f:]+$/i.test(ip);
}

function getBanKv(env) {
  return env?.LIBRETV_BAN_KV || env?.LIBRETV_PROXY_KV || null;
}

export function getWhitelistIps(env) {
  return new Set(
    (env.WHITELIST_IPS || "")
      .split(/[\s,]+/)
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
}

export function getStaticBlockedIps(env) {
  const fromEnv = (env.BLOCKED_IPS || "")
    .split(/[\s,]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_BLOCKED_IPS, ...fromEnv]);
}

function banIndexKey() {
  return new Request(`${BAN_CACHE_ORIGIN}/index`);
}

function banRecordKey(ip) {
  return new Request(`${BAN_CACHE_ORIGIN}/record/${encodeURIComponent(ip)}`);
}

function banKvRecordKey(ip) {
  return `${BAN_KV_RECORD_PREFIX}${ip}`;
}

async function readBanIndexFromCache(cache) {
  const cached = await cache.match(banIndexKey());
  if (!cached) return [];
  try {
    const data = await cached.json();
    return Array.isArray(data?.ips) ? data.ips : [];
  } catch {
    return [];
  }
}

async function writeBanIndexToCache(cache, ips) {
  await cache.put(
    banIndexKey(),
    new Response(JSON.stringify({ ips }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${Math.ceil(BAN_CACHE_TTL_MS / 1000)}`,
      },
    }),
  );
}

async function readBanRecordFromCache(cache, ip) {
  const cached = await cache.match(banRecordKey(ip));
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return null;
  }
}

async function writeBanRecordToCache(cache, record) {
  await cache.put(
    banRecordKey(record.ip),
    new Response(JSON.stringify(record), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${Math.ceil(BAN_CACHE_TTL_MS / 1000)}`,
      },
    }),
  );
}

async function readBanIndexFromKv(kv) {
  const raw = await kv.get(BAN_KV_INDEX_KEY);
  if (!raw) return [];
  try {
    const ips = JSON.parse(raw);
    return Array.isArray(ips) ? ips : [];
  } catch {
    return [];
  }
}

async function writeBanIndexToKv(kv, ips) {
  await kv.put(BAN_KV_INDEX_KEY, JSON.stringify(ips));
}

async function readBanRecordFromKv(kv, ip) {
  const raw = await kv.get(banKvRecordKey(ip));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeBanRecordToKv(kv, record) {
  await kv.put(banKvRecordKey(record.ip), JSON.stringify(record));
  const ips = await readBanIndexFromKv(kv);
  if (!ips.includes(record.ip)) {
    ips.push(record.ip);
    await writeBanIndexToKv(kv, ips);
  }
}

async function deleteBanRecordFromKv(kv, ip) {
  await kv.delete(banKvRecordKey(ip));
  const ips = await readBanIndexFromKv(kv);
  await writeBanIndexToKv(
    kv,
    ips.filter((item) => item !== ip),
  );
}

async function listDynamicBansFromCache() {
  const cache = caches.default;
  const ips = await readBanIndexFromCache(cache);
  const records = [];

  for (const ip of ips) {
    const record = await readBanRecordFromCache(cache, ip);
    if (record) records.push(record);
  }

  return records;
}

async function listDynamicBansFromKv(kv) {
  const ips = await readBanIndexFromKv(kv);
  const records = [];

  for (const ip of ips) {
    const record = await readBanRecordFromKv(kv, ip);
    if (record) records.push(record);
  }

  return records;
}

function mergeBanRecords(primary, secondary) {
  const map = new Map();
  for (const record of secondary) {
    map.set(record.ip, record);
  }
  for (const record of primary) {
    map.set(record.ip, record);
  }
  return [...map.values()].sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
}

export async function banIp(ip, source, reason, env) {
  if (!isValidIp(ip)) {
    throw new Error("invalid_ip");
  }
  if (getWhitelistIps(env).has(ip)) {
    throw new Error("whitelisted");
  }

  const record = {
    ip,
    source,
    reason: reason || (source === "auto" ? "检测到规律性机器人行为" : "手动封禁"),
    bannedAt: Date.now(),
  };

  const kv = getBanKv(env);
  if (kv) {
    await writeBanRecordToKv(kv, record);
  }

  // 兼容旧 Edge Cache 写入（同机房即时生效）
  const cache = caches.default;
  await writeBanRecordToCache(cache, record);
  const cacheIps = await readBanIndexFromCache(cache);
  if (!cacheIps.includes(ip)) {
    cacheIps.push(ip);
    await writeBanIndexToCache(cache, cacheIps);
  }

  return record;
}

export async function unbanIp(ip, env) {
  if (!isValidIp(ip)) {
    throw new Error("invalid_ip");
  }

  const kv = getBanKv(env);
  if (kv) {
    await deleteBanRecordFromKv(kv, ip);
  }

  const cache = caches.default;
  await cache.delete(banRecordKey(ip));
  const cacheIps = await readBanIndexFromCache(cache);
  await writeBanIndexToCache(
    cache,
    cacheIps.filter((item) => item !== ip),
  );

  return true;
}

export async function listDynamicBans(env) {
  const kv = getBanKv(env);
  if (kv) {
    const kvRecords = await listDynamicBansFromKv(kv);
    const cacheRecords = await listDynamicBansFromCache();
    return mergeBanRecords(kvRecords, cacheRecords);
  }

  return listDynamicBansFromCache();
}

export async function isDynamicallyBanned(ip, env) {
  if (!ip) return false;

  const kv = getBanKv(env);
  if (kv) {
    const kvRecord = await readBanRecordFromKv(kv, ip);
    if (kvRecord) return true;
  }

  const cacheRecord = await readBanRecordFromCache(caches.default, ip);
  return Boolean(cacheRecord);
}

export async function isBlockedIp(request, env) {
  const ip = getClientIp(request);
  if (!ip) return false;
  if (getWhitelistIps(env).has(ip)) return false;
  if (getStaticBlockedIps(env).has(ip)) return true;
  return isDynamicallyBanned(ip, env);
}

export async function listAllBans(env) {
  const staticIps = getStaticBlockedIps(env);
  const dynamic = await listDynamicBans(env);
  const dynamicSet = new Set(dynamic.map((item) => item.ip));

  const staticRecords = [...staticIps]
    .filter((ip) => !dynamicSet.has(ip))
    .map((ip) => ({
      ip,
      source: DEFAULT_BLOCKED_IPS.includes(ip) ? "default" : "env",
      reason: DEFAULT_BLOCKED_IPS.includes(ip) ? "内置黑名单" : "环境变量 BLOCKED_IPS",
      bannedAt: null,
      readonly: true,
    }));

  return [
    ...dynamic.map((item) => ({ ...item, readonly: false })),
    ...staticRecords,
  ];
}

export function blockedResponse() {
  return new Response("Access denied", {
    status: 403,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
