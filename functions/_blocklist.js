const DEFAULT_BLOCKED_IPS = [
  "35.221.244.169",
  "35.234.63.228",
  "195.178.110.104",
];

export function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Real-IP") ||
    ""
  );
}

export function getBlockedIps(env) {
  const fromEnv = (env.BLOCKED_IPS || "")
    .split(/[\s,]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_BLOCKED_IPS, ...fromEnv]);
}

export function isBlockedIp(request, env) {
  const ip = getClientIp(request);
  if (!ip) {
    return false;
  }
  return getBlockedIps(env).has(ip);
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
