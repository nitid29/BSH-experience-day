import { rpc } from "@/lib/server/db";
import { allow, clientIp, json, normEmail, readJson, serverError, tooMany, validEmail } from "@/lib/server/http";
import type { MyBooking } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The bookings for one email (the caller's own, by the v1 no-verification rule — PRD 8.19). */
export async function POST(req: Request) {
  const body = await readJson<{ email?: string }>(req);
  const email = normEmail(body?.email);
  if (!validEmail(email)) return json({ ok: false, error: "invalid_email" }, 400);
  if (!(await allow(`lookup:ip:${clientIp(req)}`, 600, 600))) return tooMany();
  try {
    const res = await rpc<{ name: string | null; bookings: MyBooking[] }>("get_my_bookings", { p_email: email });
    return json({ ok: true, email, ...res });
  } catch (e) {
    return serverError(e);
  }
}
