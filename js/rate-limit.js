let rateLimitReloadTimer = null;

async function handleRateLimitResponse(response) {
    if (response.status !== 429) return false;

    let message = '请求过于频繁，请稍后再试';
    let requireTurnstile = false;

    try {
        const data = await response.json();
        if (data.error) message = data.error;
        requireTurnstile = !!data.requireTurnstile;
    } catch {
        // ignore
    }

    if (typeof showToast === 'function') {
        showToast(message, 'warning');
    }

    // 需要重新人机验证时，延迟刷新，避免弹窗/async 流程中连环 reload
    if (requireTurnstile && !rateLimitReloadTimer) {
        rateLimitReloadTimer = setTimeout(() => {
            rateLimitReloadTimer = null;
            window.location.reload();
        }, 2500);
    }

    return true;
}
