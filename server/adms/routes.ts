// Wire-up for biometric wall clocks:
//   • a PUBLIC, unauthenticated "/iclock" router the clocks push to (ADMS), and
//   • an ADMIN "/api/biometric-devices" API to register + monitor them.
//
// The clocks authenticate only by a pre-registered hardware serial (that's all
// ADMS carries), so the trust model today is "serial is known + reaches us over
// HTTPS". Punch payloads are low-sensitivity (an employee number + a time).
import express, { type Express, type Request, type Response, Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { insertBiometricDeviceSchema } from "@shared/schema";
import {
  buildOptionsResponse,
  ackOk,
  parseAttlog,
  tableKind,
  serialFromQuery,
} from "./protocol";
import { ingestPunches } from "./ingest";
import * as adms from "./store";

function textResponse(res: Response, body: string, status = 200): void {
  res.status(status).type("text/plain").send(body);
}

function bodyToString(req: Request): string {
  const b = (req as any).body;
  if (typeof b === "string") return b;
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  return "";
}

// ---------------------------------------------------------------------------
// Public ADMS router (/iclock/*) — this is what the physical clock talks to.
// ---------------------------------------------------------------------------
function buildIclockRouter(): Router {
  const router = Router();
  // Clocks send tab-delimited text (often text/plain or octet-stream, sometimes
  // no content-type). Capture everything as a raw text body.
  router.use(express.text({ type: () => true, limit: "4mb" }));

  // Verbose request trace — on first real-device bring-up this is how we confirm
  // the clock is reaching us and see exactly what it sends.
  router.use((req, _res, next) => {
    logger.info("[adms] request", {
      source: "adms",
      method: req.method,
      path: req.path,
      sn: serialFromQuery(req.query as any),
      table: tableKind(req.query as any) || undefined,
      bodyLen: bodyToString(req).length,
    });
    next();
  });

  // Initial handshake: the device asks for its options/registry.
  router.get("/cdata", async (req, res) => {
    const serial = serialFromQuery(req.query as any);
    if (!serial) return textResponse(res, ackOk());
    const device = await adms.getDeviceBySerial(serial);
    if (device) {
      await adms.touchDeviceLastSeen(device.id).catch(() => {});
    } else {
      logger.warn("[adms] handshake from UNREGISTERED device", { source: "adms", sn: serial });
    }
    return textResponse(res, buildOptionsResponse(serial));
  });

  // Data upload: ATTLOG (punches) and OPERLOG/other (acknowledged, not yet used).
  router.post("/cdata", async (req, res) => {
    const serial = serialFromQuery(req.query as any);
    const kind = tableKind(req.query as any);
    const device = serial ? await adms.getDeviceBySerial(serial) : undefined;

    if (device) await adms.touchDeviceLastSeen(device.id).catch(() => {});

    if (kind === "ATTLOG") {
      const punches = parseAttlog(bodyToString(req));
      if (!device) {
        // Register-first is the intended workflow, so this should be rare. ACK so
        // the device doesn't spin, but shout about it so we register the serial.
        logger.warn("[adms] ATTLOG from UNREGISTERED device — punches NOT stored", {
          source: "adms",
          sn: serial,
          count: punches.length,
        });
        return textResponse(res, ackOk(punches.length));
      }
      const r = await ingestPunches(device, punches);
      logger.info("[adms] ATTLOG ingested", { source: "adms", sn: serial, ...r });
      return textResponse(res, ackOk(punches.length));
    }

    // OPERLOG (user edits / enrollments) and anything else: ACK for now. Phase 2
    // will consume USERINFO/FINGERTMP here to bootstrap the central template store.
    return textResponse(res, ackOk());
  });

  // Command poll: we have no commands to push yet (Phase 2 pushes templates here).
  router.get("/getrequest", async (req, res) => {
    const serial = serialFromQuery(req.query as any);
    if (serial) {
      const device = await adms.getDeviceBySerial(serial);
      if (device) await adms.touchDeviceLastSeen(device.id).catch(() => {});
    }
    return textResponse(res, ackOk());
  });

  // Command results + any other iclock chatter: acknowledge so the device is happy.
  router.post("/devicecmd", (_req, res) => textResponse(res, ackOk()));
  // Terminal catch-all (no path → Express-5-safe): anything else under /iclock
  // gets a plain OK so an unexpected request never 404s the device into backoff.
  router.use((_req, res) => textResponse(res, ackOk()));

  return router;
}

// ---------------------------------------------------------------------------
// Admin API (/api/biometric-devices/*) — register + monitor clocks.
// ---------------------------------------------------------------------------
const mapUserSchema = z.object({
  deviceUserId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1),
});

function registerAdminRoutes(app: Express): void {
  app.get("/api/biometric-devices", requireAuth, requirePermission("kiosk.manage"), async (_req, res) => {
    res.json(await adms.listDevices());
  });

  app.post("/api/biometric-devices", requireAuth, requirePermission("kiosk.manage"), async (req, res) => {
    const parsed = insertBiometricDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid device" });
    }
    try {
      const device = await adms.createDevice(parsed.data);
      res.status(201).json(device);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({ message: "A device with that serial number already exists." });
      }
      throw err;
    }
  });

  app.get("/api/biometric-devices/:id/events", requireAuth, requirePermission("kiosk.manage"), async (req, res) => {
    const device = await adms.getDevice(String(req.params.id));
    if (!device) return res.status(404).json({ message: "Device not found" });
    res.json(await adms.listEvents(device.id, 100));
  });

  app.post("/api/biometric-devices/:id/map-user", requireAuth, requirePermission("kiosk.manage"), async (req, res) => {
    const device = await adms.getDevice(String(req.params.id));
    if (!device) return res.status(404).json({ message: "Device not found" });
    const parsed = mapUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid mapping" });
    }
    await adms.mapDeviceUser(device.id, parsed.data.deviceUserId, parsed.data.userId);
    res.json({ ok: true });
  });
}

/**
 * Mount both routers. Called early in server bootstrap so "/iclock" is matched
 * before the SPA catch-all, and is intentionally OUTSIDE the "/api" rate limiter
 * (clocks poll frequently).
 */
export function registerAdmsRoutes(app: Express): void {
  app.use("/iclock", buildIclockRouter());
  registerAdminRoutes(app);
  logger.info("ADMS biometric-device routes mounted (/iclock, /api/biometric-devices)", { source: "adms" });
}
