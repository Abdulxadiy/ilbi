/** Serial polling: finish a read before scheduling another, respect Retry-After and stop off screen. */
export function startSupportPolling(task: () => Promise<void>, { intervalMs = 5000, active = () => true, onError = (_error: any) => {} }: { intervalMs?: number; active?: () => boolean; onError?: (error: any) => void } = {}) {
  let stopped = false, running = false, failures = 0, blockedUntil = 0, retryPending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => { if (!stopped) timer = setTimeout(() => { void run(); }, Math.max(delay, blockedUntil - Date.now())); };
  const run = async () => {
    if (stopped || running) return;
    if (!active()) { schedule(intervalMs); return; }
    if (Date.now() < blockedUntil) { schedule(blockedUntil - Date.now()); return; }
    running = true; retryPending = false;
    try { await task(); failures = 0; blockedUntil = 0; }
    catch (error: any) { failures++; blockedUntil = Date.now() + Math.max(0, Number(error.retryAfterMs) || 0); if (!stopped) onError(error); }
    finally { running = false; schedule(retryPending ? 0 : failures ? Math.min(120000, Math.max(15000, intervalMs * 2) * 2 ** Math.min(failures - 1, 4)) : intervalMs); }
  };
  void run();
  return { stop() { stopped = true; clearTimeout(timer); }, retry() { if (stopped) return; if (running) { retryPending = true; return; } clearTimeout(timer); schedule(0); } };
}
