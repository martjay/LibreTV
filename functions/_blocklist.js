const DEFAULT_BLOCKED_IPS = [
  "35.221.244.169",
  "35.234.63.228",
  "195.178.110.104",
];

const BAN_CACHE_ORIGIN = "https://ban.internal";
const BAN_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

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

async function readBanIndex(cache) {
  const cached = await cache.match(banIndexKey());
  if (!cached) return [];
  try {
    const data = await cached.json();
    return Array.isArray(data?.ips) ? data.ips : [];
  } catch {
    return [];
  }
}

async function writeBanIndex(cache, ips) {
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

async function readBanRecord(cache, ip) {
  const cached = await cache.match(banRecordKey(ip));
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return null;
  }
}

async function writeBanRecord(cache, record) {
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

export async function banIp(ip, source, reason, env) {
  if (!isValidIp(ip)) {
    throw new Error("invalid_ip");
  }
  if (getWhitelistIps(env).has(ip)) {
    throw new Error("whitelisted");
  }

  const cache = caches.default;
  const record = {
    ip,
    source,
    reason: reason || (source === "auto" ? "检测到规律性机器人行为" : "手动封禁"),
    bannedAt: Date.now(),
  };

  await writeBanRecord(cache, record);

  const ips = await readBanIndex(cache);
  if (!ips.includes(ip)) {
    ips.push(ip);
    await writeBanIndex(cache, ips);
  }

  return record;
}

export async function unbanIp(ip) {
  if (!isValidIp(ip)) {
    throw new Error("invalid_ip");
  }

  const cache = caches.default;
  await cache.delete(banRecordKey(ip));

  const ips = await readBanIndex(cache);
  const next = ips.filter((item) => item !== ip);
  await writeBanIndex(cache, next);

  return true;
}

export async function listDynamicBans() {
  const cache = caches.default;
  const ips = await readBanIndex(cache);
  const records = [];

  for (const ip of ips) {
    const record = await readBanRecord(cache, ip);
    if (record) records.push(record);
  }

  records.sort((a, b) => b.bannedAt - a.bannedAt);
  return records;
}

export async function isDynamicallyBanned(ip) {
  if (!ip) return false;
  const record = await readBanRecord(caches.default, ip);
  return Boolean(record);
}

export async function isBlockedIp(request, env) {
  const ip = getClientIp(request);
  if (!ip) return false;
  if (getWhitelistIps(env).has(ip)) return false;
  if (getStaticBlockedIps(env).has(ip)) return true;
  return isDynamicallyBanned(ip);
}

export async function listAllBans(env) {
  const staticIps = getStaticBlockedIps(env);
  const dynamic = await listDynamicBans();
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
