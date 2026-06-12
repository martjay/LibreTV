// 密码保护功能（需同时通过 Turnstile 人机验证 + 服务端密码校验）

const PASSWORD_SESSION_KEY = "sitePasswordSession";

function isTurnstileConfigured() {
  return Boolean(window.__ENV__?.TURNSTILE_SITE_KEY);
}

/**
 * 检查是否设置了密码保护
 */
function isPasswordProtected() {
  const pwd = window.__ENV__ && window.__ENV__.PASSWORD;
  return typeof pwd === "string" && pwd.length === 64 && !/^0+$/.test(pwd);
}

function isPasswordRequired() {
  return false;
}

function markPasswordVerified() {
  const currentHash = window.__ENV__?.PASSWORD;
  sessionStorage.setItem(
    PASSWORD_SESSION_KEY,
    JSON.stringify({
      verified: true,
      passwordHash: currentHash,
      timestamp: Date.now(),
    }),
  );
  localStorage.setItem(
    PASSWORD_CONFIG.localStorageKey,
    JSON.stringify({
      verified: true,
      timestamp: Date.now(),
      passwordHash: currentHash,
    }),
  );
  if (currentHash && window.ProxyAuth?.clearAuthCache) {
    window.ProxyAuth.clearAuthCache();
  }
  if (currentHash) {
    localStorage.setItem('proxyAuthHash', currentHash);
  }
}

function isPasswordVerified() {
  try {
    if (!isPasswordProtected()) return true;

    const stored = sessionStorage.getItem(PASSWORD_SESSION_KEY);
    if (!stored) return false;

    const { verified, passwordHash, timestamp } = JSON.parse(stored);
    const currentHash = window.__ENV__?.PASSWORD;
    return (
      verified &&
      passwordHash === currentHash &&
      timestamp &&
      Date.now() - timestamp < PASSWORD_CONFIG.verificationTTL
    );
  } catch (error) {
    console.error("检查密码验证状态时出错:", error);
    return false;
  }
}

function ensurePasswordProtection() {
  if (isPasswordProtected() && !isPasswordVerified()) {
    showPasswordModal();
    throw new Error("Password verification required");
  }
  return true;
}

window.isPasswordProtected = isPasswordProtected;
window.isPasswordRequired = isPasswordRequired;
window.isPasswordVerified = isPasswordVerified;
window.ensurePasswordProtection = ensurePasswordProtection;

let passwordTurnstileToken = "";
let passwordTurnstileWidgetId = null;

async function verifyPasswordWithServer(password) {
  if (!isTurnstileConfigured()) {
    throw new Error("站点未启用人机验证");
  }
  if (!passwordTurnstileToken) {
    throw new Error("请先完成人机验证");
  }

  const response = await fetch("/__auth/password", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "CF-Turnstile-Response": passwordTurnstileToken,
    },
    body: JSON.stringify({ password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "验证失败");
  }

  return true;
}

async function sha256(message) {
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (typeof window._jsSha256 === "function") {
    return window._jsSha256(message);
  }
  throw new Error("No SHA-256 implementation available.");
}

async function mountPasswordTurnstile() {
  const container = document.getElementById("passwordTurnstile");
  if (!container || !window.TurnstileUI) return;

  passwordTurnstileToken = "";
  passwordTurnstileWidgetId = await window.TurnstileUI.mountTurnstileWidget(
    container,
    (token) => {
      passwordTurnstileToken = token || "";
    },
  );
}

function showPasswordModal() {
  const passwordModal = document.getElementById("passwordModal");
  if (!passwordModal) return;

  const doubanArea = document.getElementById("doubanArea");
  if (doubanArea) doubanArea.classList.add("hidden");

  const cancelBtn = document.getElementById("passwordCancelBtn");
  if (cancelBtn) cancelBtn.classList.add("hidden");

  const title = passwordModal.querySelector("h2");
  const description = passwordModal.querySelector("p");
  if (title) title.textContent = "访问验证";
  if (description) {
    description.textContent = "请先完成人机验证，再输入站点密码";
  }

  passwordModal.style.display = "flex";
  mountPasswordTurnstile().catch((error) => {
    showPasswordError(error.message);
  });

  setTimeout(() => {
    const passwordInput = document.getElementById("passwordInput");
    if (passwordInput) passwordInput.focus();
  }, 100);
}

function hidePasswordModal() {
  const passwordModal = document.getElementById("passwordModal");
  if (!passwordModal) return;

  hidePasswordError();

  const passwordInput = document.getElementById("passwordInput");
  if (passwordInput) passwordInput.value = "";

  passwordTurnstileToken = "";
  if (passwordTurnstileWidgetId) {
    window.TurnstileUI?.resetTurnstileWidget(passwordTurnstileWidgetId);
    passwordTurnstileWidgetId = null;
  }

  passwordModal.style.display = "none";
}

function showPasswordError(message) {
  const errorElement = document.getElementById("passwordError");
  if (errorElement) {
    errorElement.textContent = message || "密码错误，请重试";
    errorElement.classList.remove("hidden");
  }
}

function hidePasswordError() {
  const errorElement = document.getElementById("passwordError");
  if (errorElement) {
    errorElement.classList.add("hidden");
    errorElement.textContent = "密码错误，请重试";
  }
}

async function handlePasswordSubmit() {
  const passwordInput = document.getElementById("passwordInput");
  const submitBtn = document.getElementById("passwordSubmitBtn");
  const password = passwordInput ? passwordInput.value.trim() : "";

  if (!password) {
    showPasswordError("请输入密码");
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    await verifyPasswordWithServer(password);
    markPasswordVerified();
    hidePasswordModal();
    document.dispatchEvent(new CustomEvent("passwordVerified"));
  } catch (error) {
    showPasswordError(error.message);
    passwordTurnstileToken = "";
    if (passwordTurnstileWidgetId) {
      window.TurnstileUI?.resetTurnstileWidget(passwordTurnstileWidgetId);
    }
    if (passwordInput) {
      passwordInput.value = "";
      passwordInput.focus();
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function initPasswordProtection() {
  if (isPasswordProtected() && !isPasswordVerified()) {
    showPasswordModal();
  }
}

document.addEventListener("DOMContentLoaded", initPasswordProtection);
