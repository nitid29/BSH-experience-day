import { rpc } from "@/lib/server/db";
import { allow, clientIp, json, normEmail, readJson, serverError, tooMany, validEmail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cancel one booking; only succeeds if the booking belongs to that email. */
export async function POST(req: Request) {
  const body = await readJson<{ email?: string; bookingId?: string }>(req);
  const email = normEmail(body?.email);
  const id = String(body?.bookingId ?? "");
  if (!validEmail(email) || !UUID.test(id)) return json({ ok: false, error: "bad_request" }, 400);
  if (!(await allow(`cancel:ip:${clientIp(req)}`, 200, 600))) return tooMany();
  try {
    return json(await rpc("cancel_booking", { p_email: email, p_booking_id: id }));
  } catch (e) {
    return serverError(e);
  }
}
