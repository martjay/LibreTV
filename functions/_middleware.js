import {
  getSitePassword,
  getVerifyPath,
  handleTurnstileVerify,
  hasValidTurnstileSession,
  isTurnstileEnabled,
  sha256Hex,
  turnstileChallengePage,
  clearTurnstileCookieHeader,
} from "./_auth.js";
import { blockedResponse, isBlockedIp } from "./_blocklist.js";
import { trackAndCheckBot } from "./_botdetect.js";
import { ADMIN_BAN_PATH, handleBanAdminRequest } from "./_banadmin.js";
import {
  ADMIN_AUTH_PATH,
  ADMIN_LOGOUT_PATH,
  PASSWORD_AUTH_PATH,
  handleAdminAuthRequest,
  handleAdminLogoutRequest,
  handlePasswordAuthRequest,
} from "./_passwordauth.js";
import {
  burstLimitResponse,
  checkAccessRateLimit,
  checkProxyBurstRateLimit,
  rateLimitResponse,
} from "./_ratelimit.js";
import { onRequest as proxyOnRequest } from "./_proxy.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (await isBlockedIp(request, env)) {
    return blockedResponse();
  }

  if (url.pathname === PASSWORD_AUTH_PATH) {
    return handlePasswordAuthRequest(request, env);
  }

  if (url.pathname === ADMIN_AUTH_PATH) {
    return handleAdminAuthRequest(request, env);
  }

  if (url.pathname === ADMIN_LOGOUT_PATH) {
    return handleAdminLogoutRequest(request);
  }

  if (url.pathname === ADMIN_BAN_PATH || url.pathname.startsWith(`${ADMIN_BAN_PATH}/`)) {
    return handleBanAdminRequest(request, env);
  }

  const canonicalHost = env.CANONICAL_HOST || env.EXPECTED_HOSTNAME || "tv.444110.xyz";
  if (url.hostname.endsWith(".pages.dev")) {
    return Response.redirect(
      `https://${canonicalHost}${url.pathname}${url.search}`,
      302,
    );
  }

  if (url.pathname === getVerifyPath()) {
    return handleTurnstileVerify(request, env);
  }

  async function enforceRateLimit(contentType = "json") {
    const rate = await checkAccessRateLimit(request, env);
    if (!rate.exceeded) return null;

    const clearCookie = clearTurnstileCookieHeader();
    if (contentType === "html") {
      return new Response(
        turnstileChallengePage(
          env,
          url.pathname + url.search,
          "访问过于频繁，请重新完成人机验证",
        ),
        {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Set-Cookie": clearCookie,
          },
        },
      );
    }
    return rateLimitResponse(clearCookie);
  }

  // 在中间件里直接处理 /proxy/*（避免路由未匹配时落到静态 index.html）
  if (url.pathname.startsWith("/proxy/")) {
    const botResult = await trackAndCheckBot(request, env);
    if (botResult.banned) {
      return blockedResponse();
    }
    const burst = await checkProxyBurstRateLimit(request, env);
    if (burst.exceeded) {
      return burstLimitResponse();
    }
    if (isTurnstileEnabled(env)) {
      const limited = await enforceRateLimit("json");
      if (limited) return limited;
    }
    return proxyOnRequest(context);
  }

  const hasSession =
    isTurnstileEnabled(env) && (await hasValidTurnstileSession(request, env));

  if (hasSession) {
    const accept = request.headers.get("Accept") || "";
    const wantsHtml =
      accept.includes("text/html") ||
      url.pathname.endsWith(".html") ||
      url.pathname === "/";
    const botResult = await trackAndCheckBot(request, env);
    if (botResult.banned) {
      return blockedResponse();
    }
    if (wantsHtml) {
      const limited = await enforceRateLimit("html");
      if (limited) return limited;
    }
  }

  if (
    isTurnstileEnabled(env) &&
    !hasSession
  ) {
    if (request.method === "OPTIONS") {
      return next();
    }

    const accept = request.headers.get("Accept") || "";
    const wantsHtml =
      accept.includes("text/html") ||
      url.pathname.endsWith(".html") ||
      url.pathname === "/";

    if (wantsHtml) {
      return new Response(turnstileChallengePage(env, url.pathname + url.search), {
        status: 403,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(JSON.stringify({ error: "请先完成人机验证" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  const response = await next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return response;
  }

  let html = await response.text();
  const password = getSitePassword(env);
  const passwordHash = password ? await sha256Hex(password) : "";

  html = html.replace(/\{\{PASSWORD\}\}/g, passwordHash);
  html = html.replace(/\{\{ADMINPASSWORD\}\}/g, "");
  html = html.replace(/\{\{TURNSTILE_SITE_KEY\}\}/g, env.TURNSTILE_SITE_KEY || "");

  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
