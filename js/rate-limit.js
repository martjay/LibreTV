async function handleRateLimitResponse(response) {
    if (response.status !== 429) return false;
    try {
        const data = await response.json();
        if (data.requireTurnstile) {
            window.location.reload();
            return true;
        }
    } catch {
        // ignore
    }
    return false;
}
