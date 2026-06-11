// IP 封禁管理（需站点密码验证）

const BAN_ADMIN_API = "/__admin/bans";

function getAdminToken() {
  try {
    if (typeof isPasswordVerified === "function" && !isPasswordVerified()) {
      return null;
    }
    const stored = localStorage.getItem(PASSWORD_CONFIG.localStorageKey);
    if (!stored) return null;
    const { passwordHash } = JSON.parse(stored);
    return passwordHash || null;
  } catch {
    return null;
  }
}

async function banAdminFetch(path, options = {}) {
  const token = getAdminToken();
  if (!token) {
    throw new Error("请先输入站点密码验证身份");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Admin-Token": token,
    ...(options.headers || {}),
  };

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return data;
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
                : `<button type="button" data-unban-ip="${ban.ip}" class="shrink-0 text-xs px-2 py-1 bg-green-700 hover:bg-green-600 text-white rounded">放行</button>`
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

function showBanManageModal() {
  if (typeof isPasswordProtected === "function" && isPasswordProtected()) {
    if (typeof ensurePasswordProtection === "function") {
      try {
        ensurePasswordProtection();
      } catch {
        return;
      }
    } else if (typeof isPasswordVerified === "function" && !isPasswordVerified()) {
      if (typeof showPasswordModal === "function") showPasswordModal();
      return;
    }
  } else if (typeof showToast === "function") {
    showToast("请先在 Worker 环境变量中配置 SITE_PASSWORD 以启用 IP 管理", "warning");
    return;
  }

  let modal = document.getElementById("banManageModal");
  if (modal) document.body.removeChild(modal);

  modal = document.createElement("div");
  modal.id = "banManageModal";
  modal.className =
    "fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4";
  modal.innerHTML = `
    <div class="bg-[#191919] rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
      <button id="closeBanModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
      <h3 class="text-xl font-bold text-white mb-2">IP 封禁管理</h3>
      <p class="text-xs text-gray-500 mb-4">自动封禁：持续约 30 分钟、每分钟固定次数的规律性搜索/点击。手动封禁与放行需站点密码。</p>

      <form id="addBanForm" class="flex gap-2 mb-4">
        <input type="text" id="banIpInput" placeholder="IP 地址，如 1.2.3.4"
          class="flex-1 bg-[#222] border border-[#333] text-white px-3 py-2 rounded text-sm focus:outline-none focus:border-pink-500">
        <button type="submit" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm shrink-0">封禁</button>
      </form>
      <input type="text" id="banReasonInput" placeholder="封禁原因（可选）"
        class="w-full bg-[#222] border border-[#333] text-white px-3 py-2 rounded text-sm mb-4 focus:outline-none focus:border-pink-500">

      <div id="banListContainer"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const listContainer = modal.querySelector("#banListContainer");
  loadBanList(listContainer);

  modal.querySelector("#closeBanModal").addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) document.body.removeChild(modal);
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
