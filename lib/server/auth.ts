import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Admin authentication (PRD 8.10): the password lives in an environment variable and is checked on
 * the server only. A successful login sets a signed, HTTP-only cookie valid for 12 hours.
 */

export const ADMIN_COOKIE = "reu_admin";
const SESSION_HOURS = 12;

function adminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (pw) return pw;
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_PASSWORD is not set.");
  return "2026"; // local development default, same as the prototype PIN
}

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_SESSION_SECRET is not set.");
  return "local-dev-secret";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkPassword(input: string): boolean {
  return safeEqual(input, adminPassword());
}

export async function startAdminSession(): Promise<void> {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `admin.${exp}`;
  (await cookies()).set(ADMIN_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return false;
  const i = raw.lastIndexOf(".");
  if (i < 0) return false;
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  if (!safeEqual(sig, sign(payload))) return false;
  const exp = Number(payload.split(".")[1]);
  return Number.isFinite(exp) && exp > Date.now();
}
