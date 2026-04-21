function num(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(envName: string, fallback: string): string {
  return process.env[envName] || fallback;
}

export const config = {
  port: num("PORT", 5000),
  nodeEnv: str("NODE_ENV", "development"),

  dbPoolMax: num("DB_POOL_MAX", 5),
  dbIdleTimeoutMs: num("DB_IDLE_TIMEOUT_MS", 30_000),
  dbConnectionTimeoutMs: num("DB_CONNECTION_TIMEOUT_MS", 10_000),

  cacheTtlMs: num("CACHE_TTL_MS", 15_000),
  expensiveCooldownMs: num("EXPENSIVE_COOLDOWN_MS", 60_000),

  rateLimitWindowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: num("RATE_LIMIT_MAX", 240),

  slowRequestMs: num("SLOW_REQUEST_MS", 1_500),

  jobsBatchSize: num("JOBS_BATCH_SIZE", 25),

  cronSecret: process.env.CRON_SECRET || "",
};

export type AppConfig = typeof config;
