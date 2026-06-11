// IP 封禁管理（每次进入需 Turnstile + 站点密码双重验证）

const BAN_ADMIN_API = "/__admin/bans";
const ADMIN_AUTH_API = "/__admin/auth";
const ADMIN_LOGOUT_API = "/__admin/logout";

let banTurnstileToken = "";
let banTurnstileWidgetId = null;

async function banAdminFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (data.requireAdminAuth) {
      throw new Error(data.error || "需要重新完成人机验证并输入密码");
    }
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return data;
}

async function authenticateBanAdmin(password) {
  if (!banTurnstileToken) {
    throw new Error("请先完成人机验证");
  }

  const response = await fetch(ADMIN_AUTH_API, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "CF-Turnstile-Response": banTurnstileToken,
    },
    body: JSON.stringify({ password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "管理员验证失败");
  }

  return true;
}

async function logoutBanAdmin() {
  try {
    await fetch(ADMIN_LOGOUT_API, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // ignore
  }
}

function formatBanTime(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("zh-CN");
}

function getBanSourceLabel(source) {
  switch (source) {
    case "auto":
      return "自动封禁";
    case "manual":
      return "手动封禁";
    case "env":
      return "环境变量";
    case "default":
      return "内置";
    default:
      return source || "未知";
  }
}

async function loadBanList(container) {
  container.innerHTML = `
    <div class="flex items-center justify-center py-8 text-gray-400">
      <div class="w-5 h-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mr-3"></div>
      加载中...
    </div>
  `;

  try {
    const data = await banAdminFetch(BAN_ADMIN_API);
    renderBanList(container, data.bans || []);
  } catch (error) {
    container.innerHTML = `
      <div class="text-center py-6 text-red-400 text-sm">${error.message}</div>
    `;
  }
}

function renderBanList(container, bans) {
  if (!bans.length) {
    container.innerHTML = `<div class="text-center py-6 text-gray-500 text-sm">暂无封禁 IP</div>`;
    return;
  }

  container.innerHTML = bans
    .map((ban) => {
      const readonly = ban.readonly || ban.source === "env" || ban.source === "default";
      return `
        <div class="bg-[#1a1a1a] border border-[#333] rounded-lg p-3 mb-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-mono text-sm text-white break-all">${ban.ip}</div>
              <div class="text-xs text-gray-500 mt-1">${getBanSourceLabel(ban.source)} · ${formatBanTime(ban.bannedAt)}</div>
              <div class="text-xs text-gray-400 mt-1 break-words">${ban.reason || ""}</div>
            </div>
            ${
              readonly
                ? `<span class="text-xs text-gray-600 shrink-0">只读</span>`
                : `<button type="button" data-unban-ip="${ban.ip}" class="shrink-0 text-xs px-2 py-1 bg-[#333] hover:bg-[#444] border border-[#444] text-gray-200 rounded">放行</button>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll("[data-unban-ip]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ip = btn.getAttribute("data-unban-ip");
      if (!ip || !confirm(`确定放行 IP ${ip}？`)) return;

      btn.disabled = true;
      btn.textContent = "处理中...";
      try {
        await banAdminFetch(`${BAN_ADMIN_API}/${encodeURIComponent(ip)}`, {
          method: "DELETE",
        });
        if (typeof showToast === "function") {
          showToast(`已放行 ${ip}`, "success");
        }
        await loadBanList(container);
      } catch (error) {
        if (typeof showToast === "function") {
          showToast(error.message, "error");
        }
        btn.disabled = false;
        btn.textContent = "放行";
      }
    });
  });
}

async function mountBanTurnstile(container) {
  banTurnstileToken = "";
  banTurnstileWidgetId = await window.TurnstileUI.mountTurnstileWidget(
    container,
    (token) => {
      banTurnstileToken = token || "";
    },
  );
}

function closeBanManageModal(modal) {
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
  banTurnstileToken = "";
  if (banTurnstileWidgetId) {
    window.TurnstileUI?.resetTurnstileWidget(banTurnstileWidgetId);
    banTurnstileWidgetId = null;
  }
  logoutBanAdmin();
}

function showBanManageModal() {
  if (!window.__ENV__?.TURNSTILE_SITE_KEY) {
    if (typeof showToast === "function") {
      showToast("站点未启用人机验证，无法使用 IP 管理", "warning");
    }
    return;
  }

  if (typeof isPasswordProtected === "function" && !isPasswordProtected()) {
    if (typeof showToast === "function") {
      showToast("请先在 Worker 环境变量中配置 SITE_PASSWORD 以启用 IP 管理", "warning");
    }
    return;
  }

  let modal = document.getElementById("banManageModal");
  if (modal) closeBanManageModal(modal);

  modal = document.createElement("div");
  modal.id = "banManageModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4";
  modal.innerHTML = `
    <div class="bg-[#191919] rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
      <button id="closeBanModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
      <h3 class="text-xl font-bold text-white mb-2">IP 封禁管理</h3>
      <p class="text-xs text-gray-500 mb-4">每次进入需先完成 Cloudflare 人机验证并输入站点密码。</p>

      <div id="banAuthGate" class="mb-4 border border-[#333] rounded-lg p-4 bg-[#151515]">
        <div id="banTurnstile" class="flex justify-center mb-4"></div>
        <form id="banAuthForm" class="space-y-3">
          <input type="password" id="banAdminPassword" placeholder="站点密码"
            class="w-full bg-[#222] border border-[#333] text-white px-3 py-2 rounded text-sm focus:outline-none focus:border-[#555]">
          <button type="submit" id="banAuthSubmit"
            class="w-full bg-[#333] hover:bg-[#444] border border-[#444] text-gray-200 px-4 py-2 rounded text-sm">
            验证并进入
          </button>
        </form>
        <p id="banAuthError" class="text-red-400 text-xs mt-2 hidden"></p>
      </div>

      <div id="banManageContent" class="hidden">
        <form id="addBanForm" class="flex gap-2 mb-4">
          <input type="text" id="banIpInput" placeholder="IP 地址，如 1.2.3.4"
            class="flex-1 bg-[#222] border border-[#333] text-white px-3 py-2 rounded text-sm focus:outline-none focus:border-[#555]">
          <button type="submit" class="bg-[#333] hover:bg-[#444] border border-[#444] text-gray-200 px-4 py-2 rounded text-sm shrink-0">封禁</button>
        </form>
        <input type="text" id="banReasonInput" placeholder="封禁原因（可选）"
          class="w-full bg-[#222] border border-[#333] text-white px-3 py-2 rounded text-sm mb-4 focus:outline-none focus:border-[#555]">
        <div id="banListContainer"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const authGate = modal.querySelector("#banAuthGate");
  const manageContent = modal.querySelector("#banManageContent");
  const authError = modal.querySelector("#banAuthError");
  const listContainer = modal.querySelector("#banListContainer");
  const turnstileContainer = modal.querySelector("#banTurnstile");

  mountBanTurnstile(turnstileContainer).catch((error) => {
    authError.textContent = error.message;
    authError.classList.remove("hidden");
  });

  modal.querySelector("#closeBanModal").addEventListener("click", () => {
    closeBanManageModal(modal);
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeBanManageModal(modal);
  });

  modal.querySelector("#banAuthForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = modal.querySelector("#banAdminPassword").value.trim();
    const submitBtn = modal.querySelector("#banAuthSubmit");

    authError.classList.add("hidden");
    if (!password) {
      authError.textContent = "请输入站点密码";
      authError.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "验证中...";

    try {
      await authenticateBanAdmin(password);
      authGate.classList.add("hidden");
      manageContent.classList.remove("hidden");
      await loadBanList(listContainer);
    } catch (error) {
      authError.textContent = error.message;
      authError.classList.remove("hidden");
      banTurnstileToken = "";
      if (banTurnstileWidgetId) {
        window.TurnstileUI?.resetTurnstileWidget(banTurnstileWidgetId);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "验证并进入";
    }
  });

  modal.querySelector("#addBanForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const ipInput = modal.querySelector("#banIpInput");
    const reasonInput = modal.querySelector("#banReasonInput");
    const ip = ipInput.value.trim();
    const reason = reasonInput.value.trim();

    if (!ip) {
      if (typeof showToast === "function") showToast("请输入 IP 地址", "warning");
      return;
    }

    try {
      await banAdminFetch(BAN_ADMIN_API, {
        method: "POST",
        body: JSON.stringify({ ip, reason: reason || undefined }),
      });
      ipInput.value = "";
      reasonInput.value = "";
      if (typeof showToast === "function") showToast(`已封禁 ${ip}`, "success");
      await loadBanList(listContainer);
    } catch (error) {
      if (typeof showToast === "function") showToast(error.message, "error");
    }
  });
}

window.showBanManageModal = showBanManageModal;
