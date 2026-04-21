import { config } from "../config";

const lastRun = new Map<string, number>();

export function shouldRun(key: string, cooldownMs?: number): { ok: boolean; retryAfterMs: number } {
  const cooldown = cooldownMs ?? config.expensiveCooldownMs;
  const now = Date.now();
  const last = lastRun.get(key) ?? 0;
  const elapsed = now - last;
  if (elapsed < cooldown) {
    return { ok: false, retryAfterMs: cooldown - elapsed };
  }
  lastRun.set(key, now);
  return { ok: true, retryAfterMs: 0 };
}

export function resetCooldown(key: string): void {
  lastRun.delete(key);
}
