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

export function handleRouteError(
  res: Response,
  error: unknown,
  fallback = "Something went wrong",
): Response {
  // Zod
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: friendlyZodMessage(error),
      errors: error.flatten(),
    });
  }
  // Postgres-style errors (Drizzle + pg surface .code/.detail/.constraint)
  const e = error as any;
  const code: string | undefined = e?.code;
  if (typeof code === "string" && PG_CODE_MESSAGES[code]) {
    const field = extractDetail(e, "");
    const constraint: string | undefined = e?.constraint;
    let message = PG_CODE_MESSAGES[code];
    if (field) message += `: ${field}`;
    else if (constraint) message += `: ${constraint}`;
    if (code === "23514" && e?.message) message = e.message;
    return res.status(400).json({ message });
  }
  // Logged for ops, surfaced minimally to client.
  console.error("[route-error]", error);
  const msg = e?.message && typeof e.message === "string" ? e.message : fallback;
  return res.status(500).json({ message: `${fallback}: ${msg}` });
}
