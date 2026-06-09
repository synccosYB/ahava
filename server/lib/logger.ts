import { config } from "../config";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return config.nodeEnv === "production" ? "info" : "debug";
}

const minLevel = resolveMinLevel();

// Pretty (human-readable) logs by default in development, structured JSON in
// production (or when LOG_FORMAT=json is set). JSON is what log aggregators and
// observability tooling expect.
const useJson =
  (process.env.LOG_FORMAT || "").toLowerCase() === "json" ||
  config.nodeEnv === "production";

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(typeof (err as any).code !== "undefined" ? { code: (err as any).code } : {}),
    };
  }
  return { message: String(err) };
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const normalizedMeta: Record<string, unknown> | undefined = meta
    ? { ...meta }
    : undefined;
  if (normalizedMeta && normalizedMeta.err) {
    normalizedMeta.err = serializeError(normalizedMeta.err);
  }
  if (normalizedMeta && normalizedMeta.error && !normalizedMeta.err) {
    normalizedMeta.error = serializeError(normalizedMeta.error);
  }

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (useJson) {
    sink(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        message,
        ...(normalizedMeta ?? {}),
      }),
    );
    return;
  }

  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const source = (normalizedMeta?.source as string) || "express";
  const extra = normalizedMeta
    ? Object.entries(normalizedMeta)
        .filter(([k]) => k !== "source")
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  sink(`${time} [${source}] ${level.toUpperCase()} ${message}${extra ? ` ${extra}` : ""}`);
}

export const logger = {
  level: minLevel,
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

export type Logger = typeof logger;
