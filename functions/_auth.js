const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_PATH = "/__turnstile_verify";
const COOKIE_NAME = "ts_verified";
const DEFAULT_SESSION_HOURS = 24;

export function getSitePassword(env) {
  return env.SITE_PASSWORD || env.PASSWORD || "";
}

export function isTurnstileEnabled(env) {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

export function getVerifyPath() {
  return VERIFY_PATH;
}

function getSessionHours(env) {
  const hours = parseInt(env.SESSION_HOURS || String(DEFAULT_SESSION_HOURS), 10);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS;
}

async function signValue(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createTurnstileCookie(env) {
  const expiresAt = Date.now() + getSessionHours(env) * 60 * 60 * 1000;
  const payload = String(expiresAt);
  const sig = await signValue(payload, env.TURNSTILE_SECRET_KEY);
  const value = `${payload}.${sig}`;
  const maxAge = getSessionHours(env) * 60 * 60;
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export async function hasValidTurnstileSession(request, env) {
  if (!isTurnstileEnabled(env)) return true;

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const [expiresAt, sig] = match[1].split(".");
  if (!expiresAt || !sig) return false;

  const expires = parseInt(expiresAt, 10);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  const expected = await signValue(expiresAt, env.TURNSTILE_SECRET_KEY);
  return sig === expected;
}

export async function validateTurnstileToken(token, remoteip, env) {
  if (!token || token.length > 2048) return { success: false };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteip) body.append("remoteip", remoteip);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const result = await response.json();

  if (result.success && env.EXPECTED_HOSTNAME) {
    if (result.hostname !== env.EXPECTED_HOSTNAME) {
      return { success: false };
    }
  }

  return result;
}

export function turnstileChallengePage(env, redirectUrl) {
  const siteKey = env.TURNSTILE_SITE_KEY;
  const safeRedirect = JSON.stringify(redirectUrl);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>访问验证</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0f0f0f; color: #fff; font-family: system-ui, sans-serif;
    }
    .card {
      width: min(420px, 92vw); padding: 32px 28px; border-radius: 16px;
      background: #1a1a1a; border: 1px solid #333; text-align: center;
    }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 24px; color: #aaa; font-size: 14px; }
    .turnstile-wrap { display: flex; justify-content: center; margin-bottom: 20px; }
    button {
      width: 100%; padding: 12px; border: none; border-radius: 10px;
      background: #e50914; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
    }
    button:disabled { opacity: 0.5; }
    .error { color: #ff6b6b; font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>访问验证</h1>
    <p>请完成人机验证后继续访问</p>
    <div class="turnstile-wrap">
      <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="dark" data-callback="onTurnstileOk"></div>
    </div>
    <button id="submit-btn" disabled>继续访问</button>
    <div class="error" id="error" hidden>验证失败，请刷新重试</div>
  </div>
  <script>
    let token = "";
    const btn = document.getElementById("submit-btn");
    const err = document.getElementById("error");
    window.onTurnstileOk = function(t) { token = t; btn.disabled = false; };
    btn.addEventListener("click", async function() {
      if (!token) return;
      btn.disabled = true;
      err.hidden = true;
      const res = await fetch("${VERIFY_PATH}", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Turnstile-Response": token },
        body: JSON.stringify({ redirect: ${safeRedirect} }),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.redirect || "/";
        return;
      }
      err.hidden = false;
      btn.disabled = false;
    });
  </script>
</body>
</html>`;
}

export async function handleTurnstileVerify(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let redirect = "/";
  try {
    const body = await request.json();
    if (body.redirect && body.redirect.startsWith("/")) {
      redirect = body.redirect;
    }
  } catch {
    // ignore
  }

  const token =
    request.headers.get("CF-Turnstile-Response") ||
    request.headers.get("X-Turnstile-Token");
  const remoteip = request.headers.get("CF-Connecting-IP");
  const result = await validateTurnstileToken(token, remoteip, env);

  if (!result.success) {
    return new Response(JSON.stringify({ error: "验证失败" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cookie = await createTurnstileCookie(env);
  return new Response(JSON.stringify({ redirect }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
}
