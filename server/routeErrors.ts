import type { Response } from "express";
import { ZodError, type SafeParseError } from "zod";

const PG_CODE_MESSAGES: Record<string, string> = {
  "23502": "Missing required field",
  "23503": "Invalid reference",
  "23505": "Already exists",
  "23514": "Value violates a constraint",
};

function humanizeFieldPath(path: (string | number)[]): string {
  if (path.length === 0) return "field";
  return path
    .map((p) => String(p))
    .join(".")
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

export function friendlyZodMessage(err: ZodError, fallback = "Invalid request"): string {
  const issue = err.issues[0];
  if (!issue) return fallback;
  const field = humanizeFieldPath(issue.path);
  if (issue.code === "invalid_type" && (issue as any).received === "undefined") {
    return `${field} is required`;
  }
  return `${field}: ${issue.message}`;
}

export function badRequestFromZod(
  res: Response,
  parsed: SafeParseError<unknown>,
  fallback = "Invalid request",
) {
  return res.status(400).json({
    message: friendlyZodMessage(parsed.error, fallback),
    errors: parsed.error.flatten(),
  });
}

function extractDetail(err: any, key: string): string | undefined {
  const detail = (err?.detail as string | undefined) ?? "";
  const m = detail.match(/(?:Key|column) \(([^)]+)\)/);
  return m?.[1];
}

export type MappedRouteError = {
  status: number;
  message: string;
  errors?: unknown;
};

/**
 * Thrown when an optimistic, status-guarded write affects 0 rows because the
 * target row was already transitioned out of its expected state by a
 * concurrent writer (e.g. two managers approving the same correction at once).
 * Maps to HTTP 409 so the client can refresh instead of silently re-applying.
 */
export class RouteConflictError extends Error {
  constructor(message = "This was already handled by someone else.") {
    super(message);
    this.name = "RouteConflictError";
  }
}

export function mapRouteError(error: unknown, fallback = "Something went wrong"): MappedRouteError {
  if (error instanceof RouteConflictError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      message: friendlyZodMessage(error),
      errors: error.flatten(),
    };
  }
  const e = error as any;
  const code: string | undefined = e?.code;
  if (typeof code === "string" && PG_CODE_MESSAGES[code]) {
    const field = extractDetail(e, "");
    const constraint: string | undefined = e?.constraint;
    let message = PG_CODE_MESSAGES[code];
    if (field) message += `: ${field}`;
    else if (constraint) message += `: ${constraint}`;
    if (code === "23514" && e?.message) message = e.message;
    return { status: 400, message };
  }
  console.error("[route-error]", error);
  const msg = e?.message && typeof e.message === "string" ? e.message : fallback;
  return { status: 500, message: `${fallback}: ${msg}` };
}

export function handleRouteError(
  res: Response,
  error: unknown,
  fallback = "Something went wrong",
): Response {
  const mapped = mapRouteError(error, fallback);
  const body: Record<string, unknown> = { message: mapped.message };
  if (mapped.errors !== undefined) body.errors = mapped.errors;
  return res.status(mapped.status).json(body);
}
