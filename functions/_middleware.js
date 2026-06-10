import {
  getSitePassword,
  getVerifyPath,
  handleTurnstileVerify,
  hasValidTurnstileSession,
  isTurnstileEnabled,
  sha256Hex,
  turnstileChallengePage,
} from "./_auth.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === getVerifyPath()) {
    return handleTurnstileVerify(request, env);
  }

  // /proxy/* 由代理函数自行鉴权，不在中间件层拦截（避免搜索请求被 403）
  const isProxyPath = url.pathname.startsWith("/proxy/");

  if (
    !isProxyPath &&
    isTurnstileEnabled(env) &&
    !(await hasValidTurnstileSession(request, env))
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

  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
