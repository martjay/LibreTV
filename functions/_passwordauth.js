import { getClientIp } from "./_blocklist.js";
import {
  ADMIN_AUTH_PATH,
  ADMIN_LOGOUT_PATH,
  PASSWORD_AUTH_PATH,
  createAdminGateCookie,
  createPasswordSessionCookie,
  clearAdminGateCookieHeader,
  hasValidAdminGate,
  hasValidTurnstileSession,
  isTurnstileEnabled,
  sha256Hex,
  validateTurnstileToken,
  getSitePassword,
} from "./_auth.js";

export { PASSWORD_AUTH_PATH, ADMIN_AUTH_PATH, ADMIN_LOGOUT_PATH };

const PWD_FAIL_CACHE_ORIGIN = "https://pwd-auth-fail.internal";
const MAX_PWD_FAILURES = 5;
const PWD_FAIL_WINDOW_MS = 15 * 60 * 1000;

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

async function readFailRecord(ip) {
  const cache = caches.default;
  const key = new Request(`${PWD_FAIL_CACHE_ORIGIN}/${encodeURIComponent(ip)}`);
  const cached = await cache.match(key);
  if (!cached) return { failures: [] };
  try {
    const data = await cached.json();
    return Array.isArray(data?.failures) ? data : { failures: [] };
  } catch {
    return { failures: [] };
  }
}

async function writeFailRecord(ip, record) {
  const cache = caches.default;
  const key = new Request(`${PWD_FAIL_CACHE_ORIGIN}/${encodeURIComponent(ip)}`);
  await cache.put(
    key,
    new Response(JSON.stringify(record), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${Math.ceil(PWD_FAIL_WINDOW_MS / 1000)}`,
      },
    }),
  );
}

async function checkPasswordBruteForce(ip) {
  const now = Date.now();
  const record = await readFailRecord(ip);
  record.failures = record.failures.filter((t) => now - t < PWD_FAIL_WINDOW_MS);
  return record.failures.length >= MAX_PWD_FAILURES;
}

async function recordPasswordFailure(ip) {
  const now = Date.now();
  const record = await readFailRecord(ip);
  record.failures = record.failures.filter((t) => now - t < PWD_FAIL_WINDOW_MS);
  record.failures.push(now);
  await writeFailRecord(ip, record);
}

async function clearPasswordFailures(ip) {
  const cache = caches.default;
  const key = new Request(`${PWD_FAIL_CACHE_ORIGIN}/${encodeURIComponent(ip)}`);
  await cache.delete(key);
}

async function verifyTurnstileFromRequest(request, env) {
  const token =
    request.headers.get("CF-Turnstile-Response") ||
    request.headers.get("X-Turnstile-Token");
  const remoteip = request.headers.get("CF-Connecting-IP");
  const result = await validateTurnstileToken(token, remoteip, env);
  return result.success;
}

async function verifyPasswordFromBody(request, env) {
  const sitePassword = getSitePassword(env);
  if (!sitePassword) return { ok: false, error: "未配置站点密码" };

  let password = "";
  try {
    const body = await request.json();
    password = String(body.password || "").trim();
  } catch {
    return { ok: false, error: "无效请求" };
  }

  if (!password) {
    return { ok: false, error: "请输入密码" };
  }

  const inputHash = await sha256Hex(password);
  const expectedHash = await sha256Hex(sitePassword);
  if (inputHash !== expectedHash) {
    return { ok: false, error: "密码错误" };
  }

  return { ok: true };
}

export async function handlePasswordAuthRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!isTurnstileEnabled(env)) {
    return jsonResponse({ error: "未启用人机验证" }, 503);
  }

  const ip = getClientIp(request);
  if (ip && (await checkPasswordBruteForce(ip))) {
    return jsonResponse({ error: "尝试次数过多，请稍后再试" }, 429);
  }

  if (!(await verifyTurnstileFromRequest(request, env))) {
    return jsonResponse({ error: "请先完成人机验证" }, 403);
  }

  const passwordResult = await verifyPasswordFromBody(request, env);
  if (!passwordResult.ok) {
    if (ip) await recordPasswordFailure(ip);
    return jsonResponse({ error: passwordResult.error || "验证失败" }, 403);
  }

  if (ip) await clearPasswordFailures(ip);

  const cookie = await createPasswordSessionCookie(env);
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": cookie },
  );
}

export async function handleAdminAuthRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!isTurnstileEnabled(env)) {
    return jsonResponse({ error: "未启用人机验证" }, 503);
  }

  const ip = getClientIp(request);
  if (ip && (await checkPasswordBruteForce(ip))) {
    return jsonResponse({ error: "尝试次数过多，请稍后再试" }, 429);
  }

  if (!(await hasValidTurnstileSession(request, env))) {
    return jsonResponse({ error: "请先完成站点人机验证" }, 403);
  }

  if (!(await verifyTurnstileFromRequest(request, env))) {
    return jsonResponse({ error: "请完成管理员人机验证" }, 403);
  }

  const passwordResult = await verifyPasswordFromBody(request, env);
  if (!passwordResult.ok) {
    if (ip) await recordPasswordFailure(ip);
    return jsonResponse({ error: passwordResult.error || "验证失败" }, 403);
  }

  if (ip) await clearPasswordFailures(ip);

  const cookie = await createAdminGateCookie(env);
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": cookie },
  );
}

export async function handleAdminLogoutRequest(request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": clearAdminGateCookieHeader() },
  );
}

export async function verifyBanAdminAccess(request, env) {
  if (!getSitePassword(env)) {
    return { ok: false, status: 503, error: "未配置站点密码" };
  }

  if (isTurnstileEnabled(env) && !(await hasValidTurnstileSession(request, env))) {
    return { ok: false, status: 403, error: "请先完成站点人机验证" };
  }

  if (!(await hasValidAdminGate(request, env))) {
    return { ok: false, status: 401, error: "需要完成人机验证并输入管理员密码", requireAdminAuth: true };
  }

  return { ok: true };
}
