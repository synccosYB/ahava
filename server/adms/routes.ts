// Wire-up for biometric wall clocks:
//   • a PUBLIC, unauthenticated "/iclock" router the clocks push to (ADMS), and
//   • an ADMIN "/api/biometric-devices" API to register + monitor them.
//
// Clock serials are identifiers, not proof of origin. When configured,
// ADMS_INGEST_TOKEN requires an authenticated upstream supplying
// X-Ahava-ADMS-Key. For clock compatibility during beta, a missing token
// permits requests through to the handler's registered/active-serial checks.
// Serial-only identification is NOT authentication: restrict clock ingress to
// trusted network sources until a compatible authenticated gateway is in place.
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
  parseBioUpload,
  buildUserInfoCommand,
  buildFingerprintUpdateCommand,
  tableKind,
  serialFromQuery,
  isValidAdmsToken,
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

// Replace template blobs (TMP=/Tmp=) with their length so we can log the wire
// FORMAT during bring-up without ever logging biometric data. Truncated.
function redactTemplates(body: string): string {
  return body.replace(/((?:TMP|Tmp)=)(\S+)/g, (_m, k: string, v: string) => `${k}<len=${v.length}>`).slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Public ADMS router (/iclock/*) — this is what the physical clock talks to.
// ---------------------------------------------------------------------------
function buildIclockRouter(): Router {
  const router = Router();
  // Clocks send tab-delimited text (often text/plain or octet-stream, sometimes
  // no content-type). Capture everything as a raw text body.
  router.use(express.text({ type: () => true, limit: "4mb" }));

  router.use((req, res, next) => {
    const token = process.env.ADMS_INGEST_TOKEN;
    if (token && !isValidAdmsToken(token, req.get("X-Ahava-ADMS-Key"))) {
      return textResponse(res, "ERROR: unauthorized device ingress", 403);
    }
    next();
  });

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
    if (!serial) return textResponse(res, "ERROR: device serial required", 400);
    const device = await adms.getDeviceBySerial(serial);
    if (!device || !device.isActive) {
      logger.warn("[adms] handshake from unknown/inactive device", { source: "adms", sn: serial });
      return textResponse(res, "ERROR: device not registered or inactive", 403);
    }
    await adms.touchDeviceLastSeen(device.id).catch(() => {});
    return textResponse(res, buildOptionsResponse(serial));
  });

  // Data upload: ATTLOG (punches) and OPERLOG/other (acknowledged, not yet used).
  router.post("/cdata", async (req, res) => {
    const serial = serialFromQuery(req.query as any);
    const kind = tableKind(req.query as any);
    const device = serial ? await adms.getDeviceBySerial(serial) : undefined;

    if (!device || !device.isActive) {
      logger.warn("[adms] request from unknown/inactive device", { source: "adms", sn: serial });
      return textResponse(res, "ERROR: device not registered or inactive", 403);
    }
    await adms.touchDeviceLastSeen(device.id).catch(() => {});

    if (kind === "ATTLOG") {
      const punches = parseAttlog(bodyToString(req));
      const r = await ingestPunches(device, punches);
      logger.info("[adms] ATTLOG ingested", { source: "adms", sn: serial, ...r });
      // Errors are visible to admins and must not be misreported as success.
      // The event ledger retains records for reconciliation when processing
      // cannot complete (including DB/policy errors).
      if (r.errors) return textResponse(res, "ERROR: punch ingest incomplete", 503);
      return textResponse(res, ackOk(punches.length));
    }

    // OPERLOG / data upload: harvest user + fingerprint templates (Phase 2).
    // Only acts when the body actually carries USER/FP/BIODATA lines, so ordinary
    // operation logs still just ACK.
    const body = bodyToString(req);
    const bio = parseBioUpload(body);
    if (bio.users.length > 0 || bio.fingerprints.length > 0) {
      // On first bring-up, log the structure (templates redacted) so we can
      // confirm/adjust the parser against the real firmware.
      logger.info("[adms] bio upload", { source: "adms", sn: serial, sample: redactTemplates(body) });
      let stored = 0;
      for (const fp of bio.fingerprints) {
        try {
          const userId = (await adms.getMappedUserId(device.id, fp.pin)) ?? null;
          await adms.storeFingerprintTemplate({
            sourceDeviceId: device.id,
            devicePin: fp.pin,
            fingerIndex: fp.fingerIndex,
            template: fp.template,
            size: fp.size,
            valid: fp.valid,
            format: fp.format,
            userId,
            companyId: device.companyId ?? null,
          });
          stored += 1;
        } catch (err) {
          logger.error("[adms] fingerprint store failed", { source: "adms", sn: serial, pin: fp.pin, err });
        }
      }
      logger.info("[adms] bio upload harvested", {
        source: "adms", sn: serial,
        users: bio.users.length, fingerprints: bio.fingerprints.length, stored,
      });
    }
    return textResponse(res, ackOk());
  });

  // Command poll: hand the clock its next queued command(s), e.g. "upload all
  // your templates" (Harvest) or "store this template" (Distribute). Commands go
  // on the wire as `C:<seq>:<command>`; "OK" when the queue is empty.
  router.get("/getrequest", async (req, res) => {
    const serial = serialFromQuery(req.query as any);
    if (!serial) return textResponse(res, "ERROR: device serial required", 400);
    const device = await adms.getDeviceBySerial(serial);
    if (!device || !device.isActive) return textResponse(res, "ERROR: device not registered or inactive", 403);
    await adms.touchDeviceLastSeen(device.id).catch(() => {});
    const commands = await adms.takePendingCommands(device.id).catch(() => []);
    if (commands.length === 0) return textResponse(res, ackOk());
    logger.info("[adms] dispatching commands", { source: "adms", sn: serial, count: commands.length });
    return textResponse(res, commands.map((c) => `C:${c.seq}:${c.command}`).join("\n"));
  });

  // Command results: the device reports `ID=<seq>&Return=<code>&CMD=<...>`.
  router.post("/devicecmd", async (req, res) => {
    const raw = bodyToString(req);
    const m = raw.match(/\bID=(\d+)/);
    if (m) await adms.ackCommand(Number(m[1]), raw.slice(0, 500)).catch(() => {});
    logger.info("[adms] devicecmd result", { source: "adms", result: raw.slice(0, 200) });
    return textResponse(res, ackOk());
  });
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

  // Phase 2 Harvest: ask the clock to upload its users + fingerprint templates.
  // Queues the standard query commands; whichever the firmware supports will run,
  // and the uploaded templates land via POST /iclock/cdata. The clock picks these
  // up on its next poll (seconds).
  app.post("/api/biometric-devices/:id/harvest", requireAuth, requirePermission("kiosk.manage"), async (req, res) => {
    const device = await adms.getDevice(String(req.params.id));
    if (!device) return res.status(404).json({ message: "Device not found" });
    for (const command of ["DATA QUERY USERINFO", "DATA QUERY FINGERTMP", "DATA QUERY BIODATA"]) {
      await adms.enqueueCommand(device.id, command);
    }
    res.json({ ok: true, queued: 3 });
  });

  // How many fingerprint templates we've harvested from this device (for the UI).
  app.get("/api/biometric-devices/:id/fingerprints", requireAuth, requirePermission("kiosk.manage"), async (req, res) => {
    const device = await adms.getDevice(String(req.params.id));
    if (!device) return res.status(404).json({ message: "Device not found" });
    res.json({ count: await adms.countFingerprintsForDevice(device.id) });
  });

  // Phase 2 Distribute: push every mapped fingerprint (optionally scoped to the
  // device's company) DOWN to this clock, so a new/replacement clock knows
  // everyone without re-enrollment. Queues a user + template command per finger;
  // the clock applies them on its next poll. Attribution is wired by mapping the
  // target PIN → employee on this device.
  app.post("/api/biometric-devices/:id/distribute", requireAuth, requirePermission("kiosk.manage"), async (req, res) => {
    const device = await adms.getDevice(String(req.params.id));
    if (!device) return res.status(404).json({ message: "Device not found" });
    const templates = await adms.getDistributableTemplates(device.companyId ?? null);
    const seenPins = new Set<string>();
    let queued = 0;
    for (const t of templates) {
      if (!seenPins.has(t.pin)) {
        await adms.enqueueCommand(device.id, buildUserInfoCommand(t.pin, t.name));
        await adms.mapDeviceUser(device.id, t.pin, t.userId);
        seenPins.add(t.pin);
        queued += 1;
      }
      await adms.enqueueCommand(
        device.id,
        buildFingerprintUpdateCommand({
          pin: t.pin,
          fingerIndex: t.fingerIndex,
          size: t.size,
          valid: t.valid,
          template: t.template,
          format: t.format,
        }),
      );
      queued += 1;
    }
    res.json({ ok: true, people: seenPins.size, queued });
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
