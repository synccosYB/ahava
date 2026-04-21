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
import { config } from "./config";
import { rateLimit } from "./lib/rateLimit";

const app = express();

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

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") || path.startsWith("/internal")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
      if (duration >= config.slowRequestMs) {
        log(`[slow] ${req.method} ${path} ${res.statusCode} in ${duration}ms (threshold ${config.slowRequestMs}ms)`);
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
  await seed().catch((err) => console.error("Seed warning:", err));

  await setupAuth(app);
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

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
      log(`serving on port ${port}`);
    },
  );
})();
