import "server-only";
import { NextResponse } from "next/server";
import { rpc, DbError } from "./db";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}

/**
 * Returns true when the request is within the limit. Colleagues may share one corporate egress IP,
 * so per-IP limits are generous and combined with per-email limits where it makes sense.
 */
export async function allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    return await rpc<boolean>("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  } catch (e) {
    // Never block registrations because the limiter itself failed.
    console.error("[rate-limit] failed", e);
    return true;
  }
}

export function tooMany() {
  return json({ ok: false, error: "rate_limited", message: "Too many requests. Please wait a minute and try again." }, 429);
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function serverError(e: unknown) {
  console.error(e);
  const message =
    e instanceof DbError && /not configured|not set/.test(e.message)
      ? e.message
      : "The server couldn't complete that request. Please try again in a moment.";
  return json({ ok: false, error: "server_error", message }, 500);
}

export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
