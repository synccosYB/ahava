import type { User } from "@shared/schema";

export interface EmailServiceStatus {
  configured: boolean;
  provider: string | null;
  reason?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  error?: string;
}

const PROVIDER = "resend";
const RESEND_API = "https://api.resend.com/emails";

function getEnv() {
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    fromAddress:
      process.env.PASSWORD_RESET_FROM_EMAIL?.trim() ||
      process.env.RESEND_FROM_EMAIL?.trim() ||
      null,
    appUrl: process.env.APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim() || null,
  };
}

export function getEmailServiceStatus(): EmailServiceStatus {
  const env = getEnv();
  if (!env.apiKey) {
    return { configured: false, provider: PROVIDER, reason: "RESEND_API_KEY is not set" };
  }
  if (!env.fromAddress) {
    return {
      configured: false,
      provider: PROVIDER,
      reason: "PASSWORD_RESET_FROM_EMAIL (or RESEND_FROM_EMAIL) is not set",
    };
  }
  if (!env.appUrl) {
    return {
      configured: false,
      provider: PROVIDER,
      reason: "APP_URL (or PUBLIC_APP_URL) is not set — required for safe reset links",
    };
  }
  return { configured: true, provider: PROVIDER };
}

export function getConfiguredAppOrigin(): string | null {
  return getEnv().appUrl;
}

/**
 * Build a password-reset URL using ONLY the configured trusted origin
 * (APP_URL / PUBLIC_APP_URL). Request headers (Host / X-Forwarded-Host)
 * are intentionally never used here to prevent host-header poisoning,
 * which could otherwise cause the app to email reset links pointing to
 * an attacker-controlled domain. Returns null when no trusted origin is
 * configured.
 */
export function buildResetUrl(token: string): string | null {
  const env = getEnv();
  if (!env.appUrl) return null;
  const root = env.appUrl.replace(/\/+$/, "");
  return `${root}/reset-password?token=${encodeURIComponent(token)}`;
}

function renderResetEmail(user: User, resetUrl: string): EmailMessage {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "there";
  const subject = "Reset your Ahava Medical Center password";
  const text = [
    `Hi ${name},`,
    "",
    "We received a request to reset your password.",
    "",
    "Open this link within the next hour to choose a new password:",
    resetUrl,
    "",
    "If you did not request this, you can safely ignore this email — your password will stay the same.",
    "",
    "— Ahava Medical Center",
  ].join("\n");
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#123047; line-height:1.5;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>We received a request to reset your password.</p>
      <p>
        <a href="${escapeAttr(resetUrl)}"
           style="display:inline-block;padding:10px 18px;background:#1f97d4;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">
          Choose a new password
        </a>
      </p>
      <p>Or copy and paste this link into your browser:<br><span style="color:#56b9ca;word-break:break-all;">${escapeHtml(resetUrl)}</span></p>
      <p style="color:#6b7280;font-size:13px;">This link expires in 1 hour and can only be used once. If you did not request this, you can safely ignore this email — your password will stay the same.</p>
      <p style="color:#6b7280;font-size:13px;">— Ahava Medical Center</p>
    </div>
  `;
  return { to: user.email!, subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

async function sendViaResend(msg: EmailMessage): Promise<SendResult> {
  const env = getEnv();
  if (!env.apiKey || !env.fromAddress) {
    return { ok: false, provider: PROVIDER, error: "Email service not configured" };
  }
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.apiKey}`,
      },
      body: JSON.stringify({
        from: env.fromAddress,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, provider: PROVIDER, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, provider: PROVIDER };
  } catch (err) {
    return { ok: false, provider: PROVIDER, error: (err as Error).message };
  }
}

export async function sendPasswordResetEmail(
  user: User,
  resetUrl: string,
): Promise<SendResult> {
  if (!user.email) {
    return { ok: false, provider: PROVIDER, error: "User has no email address" };
  }
  const status = getEmailServiceStatus();
  if (!status.configured) {
    return { ok: false, provider: PROVIDER, error: "Email service not configured" };
  }
  const msg = renderResetEmail(user, resetUrl);
  return sendViaResend(msg);
}
