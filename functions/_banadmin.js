import {
  verifyBanAdminAccess,
} from "./_passwordauth.js";
import { banIp, listAllBans, unbanIp } from "./_blocklist.js";

export const ADMIN_BAN_PATH = "/__admin/bans";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleBanAdminRequest(request, env) {
  const access = await verifyBanAdminAccess(request, env);
  if (!access.ok) {
    return jsonResponse(
      { error: access.error, requireAdminAuth: access.requireAdminAuth || false },
      access.status || 401,
    );
  }

  const url = new URL(request.url);
  const suffix = url.pathname.slice(ADMIN_BAN_PATH.length);
  const ipFromPath = suffix.startsWith("/") ? decodeURIComponent(suffix.slice(1)) : "";

  if (request.method === "GET" && url.pathname === ADMIN_BAN_PATH) {
    const bans = await listAllBans(env);
    return jsonResponse({ bans });
  }

  if (request.method === "POST" && url.pathname === ADMIN_BAN_PATH) {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "无效 JSON" }, 400);
    }

    const ip = String(body.ip || "").trim();
    const reason = String(body.reason || "手动封禁").trim();

    try {
      const record = await banIp(ip, "manual", reason, env);
      return jsonResponse({ ok: true, ban: record });
    } catch (error) {
      if (error.message === "invalid_ip") {
        return jsonResponse({ error: "IP 格式无效" }, 400);
      }
      if (error.message === "whitelisted") {
        return jsonResponse({ error: "该 IP 在白名单中，无法封禁" }, 400);
      }
      return jsonResponse({ error: "封禁失败" }, 500);
    }
  }

  if (request.method === "DELETE" && ipFromPath) {
    try {
      await unbanIp(ipFromPath);
      return jsonResponse({ ok: true, ip: ipFromPath });
    } catch (error) {
      if (error.message === "invalid_ip") {
        return jsonResponse({ error: "IP 格式无效" }, 400);
      }
      return jsonResponse({ error: "解封失败" }, 500);
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
