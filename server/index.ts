import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import compression from "compression";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import path from 'path';
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { seed } from "./seed";
import { runMigrations } from "./migrate";
import { maybeWipeProductionData } from "./prodDataWipe";
import { healTimezones } from "./services/timezoneHeal";
import { config } from "./config";
import { rateLimit } from "./lib/rateLimit";
import { logger } from "./lib/logger";
import { pool } from "./db";

const app = express();

// Trust exactly the configured number of proxy hops so req.ip is derived from
// the trusted proxy's X-Forwarded-For entry, not a client-forged one. The rate
// limiter and any IP-based throttling depend on this being non-spoofable.
app.set("trust proxy", config.trustProxyHops);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(compression());

app.use(express.static('client/public'));

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Backwards-compatible thin wrapper around the structured logger so existing
// callers keep working while emitting through the same pipeline.
export function log(message: string, source = "express") {
  logger.info(message, { source });
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") || path.startsWith("/internal")) {
      const slow = duration >= config.slowRequestMs;
      const meta: Record<string, unknown> = {
        source: "http",
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
      };
      if (slow) {
        meta.slow = true;
        meta.thresholdMs = config.slowRequestMs;
      }
      const msg = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (slow) {
        logger.warn(`[slow] ${msg}`, meta);
      } else if (res.statusCode >= 500) {
        logger.error(msg, meta);
      } else {
        logger.info(msg, meta);
      }
    }
  });

  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/internal")) {
    return rateLimit()(req, res, next);
  }
  next();
});

(async () => {
  await runMigrations();
  // One-shot production data wipe (no-op unless WIPE_PROD_DATA is set and the
  // one-shot marker is absent; takes + verifies a backup first, and MUST fail
  // the boot if the wipe was requested but could not complete safely).
  await maybeWipeProductionData();
  await seed().catch((err) => logger.warn("Seed warning", { source: "seed", err }));

  // Task #515: sweep for any malformed stored timezone the SQL heal migration
  // couldn't reach (it only knew the one hard-coded zone). Runs after migrations
  // so the columns exist; never fatal — runtime resolution still falls back
  // safely if this fails.
  await healTimezones()
    .then(({ healed, unrecoverable }) => {
      if (healed.length > 0) {
        logger.info(
          `Timezone heal: corrected ${healed.length} record(s)`,
          { source: "timezone-heal", healed },
        );
      }
      if (unrecoverable.length > 0) {
        logger.warn(
          `Timezone heal: ${unrecoverable.length} record(s) could not be auto-recovered — surfaced for admin review`,
          { source: "timezone-heal", unrecoverable },
        );
      }
    })
    .catch((err) => logger.warn("Timezone heal warning", { source: "timezone-heal", err }));

  await setupAuth(app);
  registerAuthRoutes(app);

  // Liveness: process is up and serving. No external dependencies checked so
  // load balancers don't recycle the instance when the DB is briefly busy.
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness: verifies the app can actually serve traffic (DB reachable).
  app.get("/ready", async (_req, res) => {
    const checks: Record<string, "ok" | "error"> = {};
    let healthy = true;
    try {
      await pool.query("SELECT 1");
      checks.database = "ok";
    } catch (err) {
      checks.database = "error";
      healthy = false;
      logger.error("Readiness check failed: database unreachable", { source: "health", err });
    }
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "unhealthy",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);

    const pgMap: Record<string, string> = {
      "23502": "Missing required field",
      "23503": "Invalid reference",
      "23505": "Already exists",
      "23514": "Value violates a constraint",
    };
    if (err?.name === "ZodError" && Array.isArray(err?.issues)) {
      const issue = err.issues[0];
      const field = (issue?.path ?? []).join(".") || "field";
      return res
        .status(400)
        .json({ message: `${field}: ${issue?.message ?? "invalid"}`, errors: err.flatten?.() });
    }
    if (typeof err?.code === "string" && pgMap[err.code]) {
      const detail: string = err.detail ?? err.message ?? "";
      const match = detail.match(/\(([^)]+)\)/);
      const suffix = match?.[1] ?? err.constraint ?? "";
      const msg = suffix ? `${pgMap[err.code]}: ${suffix}` : pgMap[err.code];
      return res.status(400).json({ message: msg });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    logger.error("Internal Server Error", { source: "express", status, err });
    return res.status(status).json({ message });
  });

  app.get('/ahava-logo.jpg', (_req: any, res: any) => {
    res.sendFile(path.resolve('attached_assets/Ahava_Primary_Logo_2023_Color_1774360090942.jpg'));
  });

  app.get('/wireframes', (_req: any, res: any) => {
    res.sendFile(path.resolve('project-plan-wireframes.html'));
  });

  app.get('/wireframes/kiosk.html', (_req: any, res: any) => {
    res.sendFile(path.resolve('kiosk-wireframes.html'));
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = config.port;

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      logger.info(`serving on port ${port}`, { source: "express", port });
    },
  );
})();

// Process-level safety nets. Without these, an unhandled async error silently
// kills (or worse, hangs) the process with no diagnostic trail.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { source: "process", err: reason });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — shutting down", { source: "process", err });
  // An uncaught exception leaves the process in an undefined state; exit so the
  // supervisor (Replit / load balancer) can restart a clean instance.
  httpServer.close(() => process.exit(1));
  // Force-exit if graceful shutdown stalls.
  setTimeout(() => process.exit(1), 5_000).unref();
});
