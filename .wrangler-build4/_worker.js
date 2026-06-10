var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/_auth.js
var SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
async function sha256Hex(message) {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
var VERIFY_PATH = "/__turnstile_verify";
var COOKIE_NAME = "ts_verified";
var DEFAULT_SESSION_HOURS = 24;
function getSitePassword(env) {
  return env.SITE_PASSWORD || env.PASSWORD || "";
}
__name(getSitePassword, "getSitePassword");
function isTurnstileEnabled(env) {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}
__name(isTurnstileEnabled, "isTurnstileEnabled");
function getVerifyPath() {
  return VERIFY_PATH;
}
__name(getVerifyPath, "getVerifyPath");
function getSessionHours(env) {
  const hours = parseInt(env.SESSION_HOURS || String(DEFAULT_SESSION_HOURS), 10);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS;
}
__name(getSessionHours, "getSessionHours");
async function signValue(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(signValue, "signValue");
async function createTurnstileCookie(env) {
  const expiresAt = Date.now() + getSessionHours(env) * 60 * 60 * 1e3;
  const payload = String(expiresAt);
  const sig = await signValue(payload, env.TURNSTILE_SECRET_KEY);
  const value = `${payload}.${sig}`;
  const maxAge = getSessionHours(env) * 60 * 60;
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
__name(createTurnstileCookie, "createTurnstileCookie");
async function hasValidTurnstileSession(request, env) {
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
__name(hasValidTurnstileSession, "hasValidTurnstileSession");
async function validateTurnstileToken(token, remoteip, env) {
  if (!token || token.length > 2048) return { success: false };
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token
  });
  if (remoteip) body.append("remoteip", remoteip);
  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const result = await response.json();
  if (result.success && env.EXPECTED_HOSTNAME) {
    if (result.hostname !== env.EXPECTED_HOSTNAME) {
      return { success: false };
    }
  }
  return result;
}
__name(validateTurnstileToken, "validateTurnstileToken");
function turnstileChallengePage(env, redirectUrl) {
  const siteKey = env.TURNSTILE_SITE_KEY;
  const safeRedirect = JSON.stringify(redirectUrl);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>\u8BBF\u95EE\u9A8C\u8BC1</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer><\/script>
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
    <h1>\u8BBF\u95EE\u9A8C\u8BC1</h1>
    <p>\u8BF7\u5B8C\u6210\u4EBA\u673A\u9A8C\u8BC1\u540E\u7EE7\u7EED\u8BBF\u95EE</p>
    <div class="turnstile-wrap">
      <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="dark" data-callback="onTurnstileOk"></div>
    </div>
    <button id="submit-btn" disabled>\u7EE7\u7EED\u8BBF\u95EE</button>
    <div class="error" id="error" hidden>\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5</div>
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
  <\/script>
</body>
</html>`;
}
__name(turnstileChallengePage, "turnstileChallengePage");
async function handleTurnstileVerify(request, env) {
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
  }
  const token = request.headers.get("CF-Turnstile-Response") || request.headers.get("X-Turnstile-Token");
  const remoteip = request.headers.get("CF-Connecting-IP");
  const result = await validateTurnstileToken(token, remoteip, env);
  if (!result.success) {
    return new Response(JSON.stringify({ error: "\u9A8C\u8BC1\u5931\u8D25" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  const cookie = await createTurnstileCookie(env);
  return new Response(JSON.stringify({ redirect }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store"
    }
  });
}
__name(handleTurnstileVerify, "handleTurnstileVerify");

// worker/_proxy.js
var MEDIA_FILE_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".f4v",
  ".m4v",
  ".3gp",
  ".3g2",
  ".ts",
  ".mts",
  ".m2ts",
  ".mp3",
  ".wav",
  ".ogg",
  ".aac",
  ".m4a",
  ".flac",
  ".wma",
  ".alac",
  ".aiff",
  ".opus",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".svg",
  ".avif",
  ".heic"
];
var MEDIA_CONTENT_TYPES = ["video/", "audio/", "image/"];
async function onRequest(context) {
  const { request, env, next, waitUntil } = context;
  const url = new URL(request.url);
  const isValidAuth = await validateAuth(request, env);
  if (!isValidAuth) {
    return new Response(JSON.stringify({
      success: false,
      error: "\u4EE3\u7406\u8BBF\u95EE\u672A\u6388\u6743\uFF1A\u8BF7\u68C0\u67E5\u5BC6\u7801\u914D\u7F6E\u6216\u9274\u6743\u53C2\u6570"
    }), {
      status: 401,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Content-Type": "application/json"
      }
    });
  }
  const DEBUG_ENABLED = env.DEBUG === "true";
  const CACHE_TTL = parseInt(env.CACHE_TTL || "86400");
  const MAX_RECURSION = parseInt(env.MAX_RECURSION || "5");
  let USER_AGENTS = [
    // 提供一个基础的默认值
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ];
  try {
    const agentsJson = env.USER_AGENTS_JSON;
    if (agentsJson) {
      const parsedAgents = JSON.parse(agentsJson);
      if (Array.isArray(parsedAgents) && parsedAgents.length > 0) {
        USER_AGENTS = parsedAgents;
      } else {
        logDebug("\u73AF\u5883\u53D8\u91CF USER_AGENTS_JSON \u683C\u5F0F\u65E0\u6548\u6216\u4E3A\u7A7A\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C");
      }
    }
  } catch (e) {
    logDebug(`\u89E3\u6790\u73AF\u5883\u53D8\u91CF USER_AGENTS_JSON \u5931\u8D25: ${e.message}\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C`);
  }
  async function validateAuth(request2, env2) {
    const url2 = new URL(request2.url);
    const authHash = url2.searchParams.get("auth");
    const timestamp = url2.searchParams.get("t");
    const serverPassword = env2.SITE_PASSWORD || env2.PASSWORD;
    if (!serverPassword) {
      return true;
    }
    if (isTurnstileEnabled(env2) && await hasValidTurnstileSession(request2, env2)) {
      return true;
    }
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(serverPassword);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const serverPasswordHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      if (!authHash || authHash !== serverPasswordHash) {
        console.warn("\u4EE3\u7406\u8BF7\u6C42\u9274\u6743\u5931\u8D25\uFF1A\u5BC6\u7801\u54C8\u5E0C\u4E0D\u5339\u914D");
        return false;
      }
    } catch (error) {
      console.error("\u8BA1\u7B97\u5BC6\u7801\u54C8\u5E0C\u5931\u8D25:", error);
      return false;
    }
    if (timestamp) {
      const now = Date.now();
      const maxAge = 10 * 60 * 1e3;
      if (now - parseInt(timestamp) > maxAge) {
        console.warn("\u4EE3\u7406\u8BF7\u6C42\u9274\u6743\u5931\u8D25\uFF1A\u65F6\u95F4\u6233\u8FC7\u671F");
        return false;
      }
    }
    return true;
  }
  __name(validateAuth, "validateAuth");
  if (!validateAuth(request, env)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }
  function logDebug(message) {
    if (DEBUG_ENABLED) {
      console.log(`[Proxy Func] ${message}`);
    }
  }
  __name(logDebug, "logDebug");
  function getTargetUrlFromPath(pathname) {
    const encodedUrl = pathname.replace(/^\/proxy\//, "");
    if (!encodedUrl) return null;
    try {
      let decodedUrl = decodeURIComponent(encodedUrl);
      if (!decodedUrl.match(/^https?:\/\//i)) {
        if (encodedUrl.match(/^https?:\/\//i)) {
          decodedUrl = encodedUrl;
          logDebug(`Warning: Path was not encoded but looks like URL: ${decodedUrl}`);
        } else {
          logDebug(`\u65E0\u6548\u7684\u76EE\u6807URL\u683C\u5F0F (\u89E3\u7801\u540E): ${decodedUrl}`);
          return null;
        }
      }
      return decodedUrl;
    } catch (e) {
      logDebug(`\u89E3\u7801\u76EE\u6807URL\u65F6\u51FA\u9519: ${encodedUrl} - ${e.message}`);
      return null;
    }
  }
  __name(getTargetUrlFromPath, "getTargetUrlFromPath");
  function createResponse(body, status = 200, headers = {}) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        // No Content
        headers: responseHeaders
        // 包含上面设置的 CORS 头
      });
    }
    return new Response(body, { status, headers: responseHeaders });
  }
  __name(createResponse, "createResponse");
  function createM3u8Response(content) {
    return createResponse(content, 200, {
      "Content-Type": "application/vnd.apple.mpegurl",
      // M3U8 的标准 MIME 类型
      "Cache-Control": `public, max-age=${CACHE_TTL}`
      // 允许浏览器和CDN缓存
    });
  }
  __name(createM3u8Response, "createM3u8Response");
  function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }
  __name(getRandomUserAgent, "getRandomUserAgent");
  function getBaseUrl(urlStr) {
    try {
      const parsedUrl = new URL(urlStr);
      if (!parsedUrl.pathname || parsedUrl.pathname === "/") {
        return `${parsedUrl.origin}/`;
      }
      const pathParts = parsedUrl.pathname.split("/");
      pathParts.pop();
      return `${parsedUrl.origin}${pathParts.join("/")}/`;
    } catch (e) {
      logDebug(`\u83B7\u53D6 BaseUrl \u65F6\u51FA\u9519: ${urlStr} - ${e.message}`);
      const lastSlashIndex = urlStr.lastIndexOf("/");
      return lastSlashIndex > urlStr.indexOf("://") + 2 ? urlStr.substring(0, lastSlashIndex + 1) : urlStr + "/";
    }
  }
  __name(getBaseUrl, "getBaseUrl");
  function resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.match(/^https?:\/\//i)) {
      return relativeUrl;
    }
    try {
      return new URL(relativeUrl, baseUrl).toString();
    } catch (e) {
      logDebug(`\u89E3\u6790 URL \u5931\u8D25: baseUrl=${baseUrl}, relativeUrl=${relativeUrl}, error=${e.message}`);
      if (relativeUrl.startsWith("/")) {
        const urlObj = new URL(baseUrl);
        return `${urlObj.origin}${relativeUrl}`;
      }
      return `${baseUrl.replace(/\/[^/]*$/, "/")}${relativeUrl}`;
    }
  }
  __name(resolveUrl, "resolveUrl");
  function rewriteUrlToProxy(targetUrl) {
    return `/proxy/${encodeURIComponent(targetUrl)}`;
  }
  __name(rewriteUrlToProxy, "rewriteUrlToProxy");
  async function fetchContentWithType(targetUrl) {
    const headers = new Headers({
      "User-Agent": getRandomUserAgent(),
      "Accept": "*/*",
      // 尝试传递一些原始请求的头信息
      "Accept-Language": request.headers.get("Accept-Language") || "zh-CN,zh;q=0.9,en;q=0.8",
      // 尝试设置 Referer 为目标网站的域名，或者传递原始 Referer
      "Referer": request.headers.get("Referer") || new URL(targetUrl).origin
    });
    try {
      logDebug(`\u5F00\u59CB\u76F4\u63A5\u8BF7\u6C42: ${targetUrl}`);
      const response = await fetch(targetUrl, { headers, redirect: "follow" });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        logDebug(`\u8BF7\u6C42\u5931\u8D25: ${response.status} ${response.statusText} - ${targetUrl}`);
        throw new Error(`HTTP error ${response.status}: ${response.statusText}. URL: ${targetUrl}. Body: ${errorBody.substring(0, 150)}`);
      }
      const content = await response.text();
      const contentType = response.headers.get("Content-Type") || "";
      logDebug(`\u8BF7\u6C42\u6210\u529F: ${targetUrl}, Content-Type: ${contentType}, \u5185\u5BB9\u957F\u5EA6: ${content.length}`);
      return { content, contentType, responseHeaders: response.headers };
    } catch (error) {
      logDebug(`\u8BF7\u6C42\u5F7B\u5E95\u5931\u8D25: ${targetUrl}: ${error.message}`);
      throw new Error(`\u8BF7\u6C42\u76EE\u6807URL\u5931\u8D25 ${targetUrl}: ${error.message}`);
    }
  }
  __name(fetchContentWithType, "fetchContentWithType");
  function isM3u8Content(content, contentType) {
    if (contentType && (contentType.includes("application/vnd.apple.mpegurl") || contentType.includes("application/x-mpegurl") || contentType.includes("audio/mpegurl"))) {
      return true;
    }
    return content && typeof content === "string" && content.trim().startsWith("#EXTM3U");
  }
  __name(isM3u8Content, "isM3u8Content");
  function isMediaFile(url2, contentType) {
    if (contentType) {
      for (const mediaType of MEDIA_CONTENT_TYPES) {
        if (contentType.toLowerCase().startsWith(mediaType)) {
          return true;
        }
      }
    }
    const urlLower = url2.toLowerCase();
    for (const ext of MEDIA_FILE_EXTENSIONS) {
      if (urlLower.endsWith(ext) || urlLower.includes(`${ext}?`)) {
        return true;
      }
    }
    return false;
  }
  __name(isMediaFile, "isMediaFile");
  function processKeyLine(line, baseUrl) {
    return line.replace(/URI="([^"]+)"/, (match, uri) => {
      const absoluteUri = resolveUrl(baseUrl, uri);
      logDebug(`\u5904\u7406 KEY URI: \u539F\u59CB='${uri}', \u7EDD\u5BF9='${absoluteUri}'`);
      return `URI="${rewriteUrlToProxy(absoluteUri)}"`;
    });
  }
  __name(processKeyLine, "processKeyLine");
  function processMapLine(line, baseUrl) {
    return line.replace(/URI="([^"]+)"/, (match, uri) => {
      const absoluteUri = resolveUrl(baseUrl, uri);
      logDebug(`\u5904\u7406 MAP URI: \u539F\u59CB='${uri}', \u7EDD\u5BF9='${absoluteUri}'`);
      return `URI="${rewriteUrlToProxy(absoluteUri)}"`;
    });
  }
  __name(processMapLine, "processMapLine");
  function processMediaPlaylist(url2, content) {
    const baseUrl = getBaseUrl(url2);
    const lines = content.split("\n");
    const output = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line && i === lines.length - 1) {
        output.push(line);
        continue;
      }
      if (!line) continue;
      if (line.startsWith("#EXT-X-KEY")) {
        output.push(processKeyLine(line, baseUrl));
        continue;
      }
      if (line.startsWith("#EXT-X-MAP")) {
        output.push(processMapLine(line, baseUrl));
        continue;
      }
      if (line.startsWith("#EXTINF")) {
        output.push(line);
        continue;
      }
      if (!line.startsWith("#")) {
        const absoluteUrl = resolveUrl(baseUrl, line);
        logDebug(`\u91CD\u5199\u5A92\u4F53\u7247\u6BB5: \u539F\u59CB='${line}', \u7EDD\u5BF9='${absoluteUrl}'`);
        output.push(rewriteUrlToProxy(absoluteUrl));
        continue;
      }
      output.push(line);
    }
    return output.join("\n");
  }
  __name(processMediaPlaylist, "processMediaPlaylist");
  async function processM3u8Content(targetUrl, content, recursionDepth = 0, env2) {
    if (content.includes("#EXT-X-STREAM-INF") || content.includes("#EXT-X-MEDIA:")) {
      logDebug(`\u68C0\u6D4B\u5230\u4E3B\u64AD\u653E\u5217\u8868: ${targetUrl}`);
      return await processMasterPlaylist(targetUrl, content, recursionDepth, env2);
    }
    logDebug(`\u68C0\u6D4B\u5230\u5A92\u4F53\u64AD\u653E\u5217\u8868: ${targetUrl}`);
    return processMediaPlaylist(targetUrl, content);
  }
  __name(processM3u8Content, "processM3u8Content");
  async function processMasterPlaylist(url2, content, recursionDepth, env2) {
    if (recursionDepth > MAX_RECURSION) {
      throw new Error(`\u5904\u7406\u4E3B\u5217\u8868\u65F6\u9012\u5F52\u5C42\u6570\u8FC7\u591A (${MAX_RECURSION}): ${url2}`);
    }
    const baseUrl = getBaseUrl(url2);
    const lines = content.split("\n");
    let highestBandwidth = -1;
    let bestVariantUrl = "";
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
        const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
        const currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
        let variantUriLine = "";
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j].trim();
          if (line && !line.startsWith("#")) {
            variantUriLine = line;
            i = j;
            break;
          }
        }
        if (variantUriLine && currentBandwidth >= highestBandwidth) {
          highestBandwidth = currentBandwidth;
          bestVariantUrl = resolveUrl(baseUrl, variantUriLine);
        }
      }
    }
    if (!bestVariantUrl) {
      logDebug(`\u4E3B\u5217\u8868\u4E2D\u672A\u627E\u5230 BANDWIDTH \u6216 STREAM-INF\uFF0C\u5C1D\u8BD5\u67E5\u627E\u7B2C\u4E00\u4E2A\u5B50\u5217\u8868\u5F15\u7528: ${url2}`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith("#") && (line.endsWith(".m3u8") || line.includes(".m3u8?"))) {
          bestVariantUrl = resolveUrl(baseUrl, line);
          logDebug(`\u5907\u9009\u65B9\u6848\uFF1A\u627E\u5230\u7B2C\u4E00\u4E2A\u5B50\u5217\u8868\u5F15\u7528: ${bestVariantUrl}`);
          break;
        }
      }
    }
    if (!bestVariantUrl) {
      logDebug(`\u5728\u4E3B\u5217\u8868 ${url2} \u4E2D\u672A\u627E\u5230\u4EFB\u4F55\u6709\u6548\u7684\u5B50\u64AD\u653E\u5217\u8868 URL\u3002\u53EF\u80FD\u683C\u5F0F\u6709\u95EE\u9898\u6216\u4EC5\u5305\u542B\u97F3\u9891/\u5B57\u5E55\u3002\u5C06\u5C1D\u8BD5\u6309\u5A92\u4F53\u5217\u8868\u5904\u7406\u539F\u59CB\u5185\u5BB9\u3002`);
      return processMediaPlaylist(url2, content);
    }
    const cacheKey = `m3u8_processed:${bestVariantUrl}`;
    let kvNamespace = null;
    try {
      kvNamespace = env2.LIBRETV_PROXY_KV;
      if (!kvNamespace) throw new Error("KV \u547D\u540D\u7A7A\u95F4\u672A\u7ED1\u5B9A");
    } catch (e) {
      logDebug(`KV \u547D\u540D\u7A7A\u95F4 'LIBRETV_PROXY_KV' \u8BBF\u95EE\u51FA\u9519\u6216\u672A\u7ED1\u5B9A: ${e.message}`);
      kvNamespace = null;
    }
    if (kvNamespace) {
      try {
        const cachedContent = await kvNamespace.get(cacheKey);
        if (cachedContent) {
          logDebug(`[\u7F13\u5B58\u547D\u4E2D] \u4E3B\u5217\u8868\u7684\u5B50\u5217\u8868: ${bestVariantUrl}`);
          return cachedContent;
        } else {
          logDebug(`[\u7F13\u5B58\u672A\u547D\u4E2D] \u4E3B\u5217\u8868\u7684\u5B50\u5217\u8868: ${bestVariantUrl}`);
        }
      } catch (kvError) {
        logDebug(`\u4ECE KV \u8BFB\u53D6\u7F13\u5B58\u5931\u8D25 (${cacheKey}): ${kvError.message}`);
      }
    }
    logDebug(`\u9009\u62E9\u7684\u5B50\u5217\u8868 (\u5E26\u5BBD: ${highestBandwidth}): ${bestVariantUrl}`);
    const { content: variantContent, contentType: variantContentType } = await fetchContentWithType(bestVariantUrl);
    if (!isM3u8Content(variantContent, variantContentType)) {
      logDebug(`\u83B7\u53D6\u5230\u7684\u5B50\u5217\u8868 ${bestVariantUrl} \u4E0D\u662F M3U8 \u5185\u5BB9 (\u7C7B\u578B: ${variantContentType})\u3002\u53EF\u80FD\u76F4\u63A5\u662F\u5A92\u4F53\u6587\u4EF6\uFF0C\u8FD4\u56DE\u539F\u59CB\u5185\u5BB9\u3002`);
      return processMediaPlaylist(bestVariantUrl, variantContent);
    }
    const processedVariant = await processM3u8Content(bestVariantUrl, variantContent, recursionDepth + 1, env2);
    if (kvNamespace) {
      try {
        waitUntil(kvNamespace.put(cacheKey, processedVariant, { expirationTtl: CACHE_TTL }));
        logDebug(`\u5DF2\u5C06\u5904\u7406\u540E\u7684\u5B50\u5217\u8868\u5199\u5165\u7F13\u5B58: ${bestVariantUrl}`);
      } catch (kvError) {
        logDebug(`\u5411 KV \u5199\u5165\u7F13\u5B58\u5931\u8D25 (${cacheKey}): ${kvError.message}`);
      }
    }
    return processedVariant;
  }
  __name(processMasterPlaylist, "processMasterPlaylist");
  try {
    const targetUrl = getTargetUrlFromPath(url.pathname);
    if (!targetUrl) {
      logDebug(`\u65E0\u6548\u7684\u4EE3\u7406\u8BF7\u6C42\u8DEF\u5F84: ${url.pathname}`);
      return createResponse("\u65E0\u6548\u7684\u4EE3\u7406\u8BF7\u6C42\u3002\u8DEF\u5F84\u5E94\u4E3A /proxy/<\u7ECF\u8FC7\u7F16\u7801\u7684URL>", 400);
    }
    logDebug(`\u6536\u5230\u4EE3\u7406\u8BF7\u6C42: ${targetUrl}`);
    const cacheKey = `proxy_raw:${targetUrl}`;
    let kvNamespace = null;
    try {
      kvNamespace = env.LIBRETV_PROXY_KV;
      if (!kvNamespace) throw new Error("KV \u547D\u540D\u7A7A\u95F4\u672A\u7ED1\u5B9A");
    } catch (e) {
      logDebug(`KV \u547D\u540D\u7A7A\u95F4 'LIBRETV_PROXY_KV' \u8BBF\u95EE\u51FA\u9519\u6216\u672A\u7ED1\u5B9A: ${e.message}`);
      kvNamespace = null;
    }
    if (kvNamespace) {
      try {
        const cachedDataJson = await kvNamespace.get(cacheKey);
        if (cachedDataJson) {
          logDebug(`[\u7F13\u5B58\u547D\u4E2D] \u539F\u59CB\u5185\u5BB9: ${targetUrl}`);
          const cachedData = JSON.parse(cachedDataJson);
          const content2 = cachedData.body;
          let headers = {};
          try {
            headers = JSON.parse(cachedData.headers);
          } catch (e) {
          }
          const contentType2 = headers["content-type"] || headers["Content-Type"] || "";
          if (isM3u8Content(content2, contentType2)) {
            logDebug(`\u7F13\u5B58\u5185\u5BB9\u662F M3U8\uFF0C\u91CD\u65B0\u5904\u7406: ${targetUrl}`);
            const processedM3u8 = await processM3u8Content(targetUrl, content2, 0, env);
            return createM3u8Response(processedM3u8);
          } else {
            logDebug(`\u4ECE\u7F13\u5B58\u8FD4\u56DE\u975E M3U8 \u5185\u5BB9: ${targetUrl}`);
            return createResponse(content2, 200, new Headers(headers));
          }
        } else {
          logDebug(`[\u7F13\u5B58\u672A\u547D\u4E2D] \u539F\u59CB\u5185\u5BB9: ${targetUrl}`);
        }
      } catch (kvError) {
        logDebug(`\u4ECE KV \u8BFB\u53D6\u6216\u89E3\u6790\u7F13\u5B58\u5931\u8D25 (${cacheKey}): ${kvError.message}`);
      }
    }
    const { content, contentType, responseHeaders } = await fetchContentWithType(targetUrl);
    if (kvNamespace) {
      try {
        const headersToCache = {};
        responseHeaders.forEach((value, key) => {
          headersToCache[key.toLowerCase()] = value;
        });
        const cacheValue = { body: content, headers: JSON.stringify(headersToCache) };
        waitUntil(kvNamespace.put(cacheKey, JSON.stringify(cacheValue), { expirationTtl: CACHE_TTL }));
        logDebug(`\u5DF2\u5C06\u539F\u59CB\u5185\u5BB9\u5199\u5165\u7F13\u5B58: ${targetUrl}`);
      } catch (kvError) {
        logDebug(`\u5411 KV \u5199\u5165\u7F13\u5B58\u5931\u8D25 (${cacheKey}): ${kvError.message}`);
      }
    }
    if (isM3u8Content(content, contentType)) {
      logDebug(`\u5185\u5BB9\u662F M3U8\uFF0C\u5F00\u59CB\u5904\u7406: ${targetUrl}`);
      const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
      return createM3u8Response(processedM3u8);
    } else {
      logDebug(`\u5185\u5BB9\u4E0D\u662F M3U8 (\u7C7B\u578B: ${contentType})\uFF0C\u76F4\u63A5\u8FD4\u56DE: ${targetUrl}`);
      const finalHeaders = new Headers(responseHeaders);
      finalHeaders.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
      finalHeaders.set("Access-Control-Allow-Origin", "*");
      finalHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
      finalHeaders.set("Access-Control-Allow-Headers", "*");
      return createResponse(content, 200, finalHeaders);
    }
  } catch (error) {
    logDebug(`\u5904\u7406\u4EE3\u7406\u8BF7\u6C42\u65F6\u53D1\u751F\u4E25\u91CD\u9519\u8BEF: ${error.message} 
 ${error.stack}`);
    return createResponse(`\u4EE3\u7406\u5904\u7406\u9519\u8BEF: ${error.message}`, 500);
  }
}
__name(onRequest, "onRequest");

// worker/_middleware.js
async function onRequest2(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (url.pathname === getVerifyPath()) {
    return handleTurnstileVerify(request, env);
  }
  if (url.pathname.startsWith("/proxy/")) {
    return onRequest(context);
  }
  if (isTurnstileEnabled(env) && !await hasValidTurnstileSession(request, env)) {
    if (request.method === "OPTIONS") {
      return next();
    }
    const accept = request.headers.get("Accept") || "";
    const wantsHtml = accept.includes("text/html") || url.pathname.endsWith(".html") || url.pathname === "/";
    if (wantsHtml) {
      return new Response(turnstileChallengePage(env, url.pathname + url.search), {
        status: 403,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
    return new Response(JSON.stringify({ error: "\u8BF7\u5148\u5B8C\u6210\u4EBA\u673A\u9A8C\u8BC1" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
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
    headers
  });
}
__name(onRequest2, "onRequest");

// _worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    return onRequest2({
      request,
      env,
      next: /* @__PURE__ */ __name(() => env.ASSETS.fetch(request), "next"),
      waitUntil: ctx.waitUntil.bind(ctx)
    });
  }
};
export {
  worker_default as default
};
