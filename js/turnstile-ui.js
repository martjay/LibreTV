let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile-script="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile 脚本加载失败")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile 脚本加载失败"));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

async function mountTurnstileWidget(container, onToken) {
  const siteKey = window.__ENV__?.TURNSTILE_SITE_KEY;
  if (!siteKey) {
    throw new Error("未配置 Turnstile 站点密钥");
  }

  await loadTurnstileScript();
  container.innerHTML = "";

  return window.turnstile.render(container, {
    sitekey: siteKey,
    theme: "dark",
    callback(token) {
      onToken(token);
    },
    "expired-callback"() {
      onToken("");
    },
    "error-callback"() {
      onToken("");
    },
  });
}

function resetTurnstileWidget(widgetId) {
  if (window.turnstile && widgetId) {
    try {
      window.turnstile.reset(widgetId);
    } catch {
      // ignore
    }
  }
}

window.TurnstileUI = {
  loadTurnstileScript,
  mountTurnstileWidget,
  resetTurnstileWidget,
};
