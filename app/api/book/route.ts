import { rpc } from "@/lib/server/db";
import { getConfig } from "@/lib/server/config";
import { emailDomainAllowed } from "@/lib/config";
import { allow, clientIp, json, normEmail, readJson, serverError, tooMany, validEmail } from "@/lib/server/http";
import type { BookResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Book one or more sessions. The database function re-validates rules and capacity under lock and
 * assigns confirmed/waitlist at commit; it is all-or-nothing and returns an outcome per session.
 */
export async function POST(req: Request) {
  const body = await readJson<{ name?: string; email?: string; sessionIds?: unknown; website?: string; startedAt?: number }>(req);
  if (!body) return json({ ok: false, error: "bad_request" }, 400);

  // Honeypot: real users never see or fill the "website" field.
  if (body.website) return json({ ok: false, error: "bad_request" }, 400);

  const name = String(body.name ?? "").trim();
  const email = normEmail(body.email);
  const ids = Array.isArray(body.sessionIds) ? body.sessionIds.filter((x): x is string => typeof x === "string") : [];
  if (name.length < 2 || name.length > 120) return json({ ok: false, error: "invalid_name" }, 400);
  if (!validEmail(email)) return json({ ok: false, error: "invalid_email" }, 400);
  if (!ids.length || ids.length > 20) return json({ ok: false, error: "no_sessions" }, 400);

  if (!(await allow(`book:ip:${clientIp(req)}`, 1500, 600))) return tooMany();
  if (!(await allow(`book:email:${email}`, 30, 600))) return tooMany();

  try {
    const cfg = await getConfig();
    if (!emailDomainAllowed(cfg, email)) return json({ ok: false, error: "invalid_email" }, 400);
    const res = await rpc<BookResponse>("book_sessions", { p_name: name, p_email: email, p_session_ids: ids });
    return json(res, 200);
  } catch (e) {
    return serverError(e);
  }
}
