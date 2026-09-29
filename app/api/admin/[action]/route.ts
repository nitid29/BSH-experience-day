import { rpc } from "@/lib/server/db";
import { getConfig } from "@/lib/server/config";
import { checkPassword, endAdminSession, isAdmin, startAdminSession } from "@/lib/server/auth";
import { allow, clientIp, json, readJson, serverError, tooMany } from "@/lib/server/http";
import { buildSessions, validateConfig, type EventConfig } from "@/lib/config";
import { detailCsv, peopleCsv } from "@/lib/csv";
import type { AdminBooking, Availability } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unauthorized = () => json({ ok: false, error: "unauthorized" }, 401);
const stamp = () => new Date().toISOString().slice(0, 10);

function download(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request, { params }: Ctx) {
  const { action } = await params;
  try {
    if (action === "session") return json({ ok: true, admin: await isAdmin() });
    if (!(await isAdmin())) return unauthorized();

    switch (action) {
      case "data":
        return json(await rpc<{ availability: Availability; registrations: AdminBooking[] }>("admin_list"));
      case "audit":
        return json(await rpc("admin_audit", { p_limit: 1000 }));
      case "config":
        return json({ ok: true, config: await getConfig() });
      case "export": {
        const type = new URL(req.url).searchParams.get("type");
        const { registrations } = await rpc<{ registrations: AdminBooking[] }>("admin_list");
        const cfg = await getConfig();
        if (type === "people") return download(peopleCsv(cfg, registrations), `reu-participants-${stamp()}.csv`, "text/csv; charset=utf-8");
        if (type === "detail") return download(detailCsv(cfg, registrations), `reu-bookings-detailed-${stamp()}.csv`, "text/csv; charset=utf-8");
        if (type === "backup")
          return download(JSON.stringify(registrations, null, 2), `reu-registrations-backup-${stamp()}.json`, "application/json");
        return json({ ok: false, error: "unknown export type" }, 400);
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { action } = await params;
  try {
    if (action === "login") {
      if (!(await allow(`login:ip:${clientIp(req)}`, 10, 900))) return tooMany();
      const body = await readJson<{ password?: string }>(req);
      if (!body?.password || !checkPassword(String(body.password))) {
        return json({ ok: false, error: "Incorrect password. Try again." }, 401);
      }
      await startAdminSession();
      return json({ ok: true });
    }
    if (action === "logout") {
      await endAdminSession();
      return json({ ok: true });
    }

    if (!(await isAdmin())) return unauthorized();
    const body = (await readJson<Record<string, unknown>>(req)) ?? {};

    switch (action) {
      case "add":
        return json(
          await rpc("admin_add", {
            p_name: String(body.name ?? ""),
            p_email: String(body.email ?? ""),
            p_session_id: String(body.sessionId ?? ""),
            p_forced: body.forced === true,
          }),
        );
      case "move":
        if (!UUID.test(String(body.id))) return json({ ok: false, error: "Invalid booking." }, 400);
        return json(
          await rpc("admin_move", { p_id: String(body.id), p_session_id: String(body.sessionId ?? ""), p_forced: body.forced === true }),
        );
      case "remove":
        if (!UUID.test(String(body.id))) return json({ ok: false, error: "Invalid booking." }, 400);
        return json(await rpc("admin_remove", { p_id: String(body.id) }));
      case "import":
        if (!Array.isArray(body.rows)) return json({ ok: false, error: "Invalid file format." }, 400);
        return json(await rpc("admin_import", { p_rows: body.rows }));
      case "config": {
        const cfg = body.config as EventConfig;
        const errors = validateConfig(cfg);
        if (errors.length) return json({ ok: false, error: "invalid_config", errors }, 400);
        const res = await rpc("admin_apply_config", { p_config: cfg, p_sessions: buildSessions(cfg) });
        return json(res);
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    return serverError(e);
  }
}
