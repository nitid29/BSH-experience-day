import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Every read and write goes through the Postgres functions defined in supabase/migrations.
 *
 * - Production: Supabase. Participant functions are called with the anon key (least privilege; the
 *   database only exposes counts and the caller's own bookings). Admin functions use the service key,
 *   which never leaves the server.
 * - Local development without Supabase credentials: an embedded Postgres (PGlite) running the very same
 *   migration, persisted to .data/pglite. This lets the whole app run with `npm run dev` and no setup.
 */

type ArgType = "text" | "text[]" | "uuid" | "boolean" | "int" | "jsonb";
type Role = "anon" | "service";

const RPC = {
  get_event_config: { role: "anon", args: [] },
  get_availability: { role: "anon", args: [] },
  get_my_bookings: { role: "anon", args: [["p_email", "text"]] },
  book_sessions: { role: "anon", args: [["p_name", "text"], ["p_email", "text"], ["p_session_ids", "text[]"]] },
  cancel_booking: { role: "anon", args: [["p_email", "text"], ["p_booking_id", "uuid"]] },
  admin_list: { role: "service", args: [] },
  admin_add: { role: "service", args: [["p_name", "text"], ["p_email", "text"], ["p_session_id", "text"], ["p_forced", "boolean"]] },
  admin_move: { role: "service", args: [["p_id", "uuid"], ["p_session_id", "text"], ["p_forced", "boolean"]] },
  admin_remove: { role: "service", args: [["p_id", "uuid"]] },
  admin_import: { role: "service", args: [["p_rows", "jsonb"]] },
  admin_apply_config: { role: "service", args: [["p_config", "jsonb"], ["p_sessions", "jsonb"]] },
  admin_audit: { role: "service", args: [["p_limit", "int"]] },
  rate_limit_hit: { role: "service", args: [["p_key", "text"], ["p_max", "int"], ["p_window_seconds", "int"]] },
} as const satisfies Record<string, { role: Role; args: readonly (readonly [string, ArgType])[] }>;

export type RpcName = keyof typeof RPC;

export class DbError extends Error {}

export function dbMode(): "supabase" | "local" {
  if (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) return "supabase";
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_DB !== "1") {
    throw new DbError(
      "Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see README).",
    );
  }
  return "local";
}

export async function rpc<T = unknown>(name: RpcName, params: Record<string, unknown> = {}): Promise<T> {
  const def = RPC[name];
  return dbMode() === "supabase" ? supabaseRpc<T>(name, def.role, params) : localRpc<T>(name, def.args, params);
}

/* ---------------- Supabase ---------------- */

const g = globalThis as unknown as {
  __reuSb?: Partial<Record<Role, SupabaseClient>>;
  __reuPg?: Promise<import("@electric-sql/pglite").PGlite>;
};

function supabase(role: Role): SupabaseClient {
  g.__reuSb ??= {};
  const cached = g.__reuSb[role];
  if (cached) return cached;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    role === "service"
      ? process.env.SUPABASE_SERVICE_ROLE_KEY
      : process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new DbError(
      role === "service" ? "SUPABASE_SERVICE_ROLE_KEY is not set." : "SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set.",
    );
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  g.__reuSb[role] = client;
  return client;
}

async function supabaseRpc<T>(name: string, role: Role, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase(role).rpc(name, params);
  if (error) {
    console.error(`[db] ${name} failed`, error);
    throw new DbError(error.message);
  }
  return data as T;
}

/* ---------------- Local (PGlite) ---------------- */

async function localDb() {
  g.__reuPg ??= (async () => {
    const [{ PGlite }, fs, path] = await Promise.all([
      import("@electric-sql/pglite"),
      import("node:fs"),
      import("node:path"),
    ]);
    const dataDir = process.env.LOCAL_DB_DIR || path.join(process.cwd(), ".data", "pglite");
    fs.mkdirSync(dataDir, { recursive: true });
    const db = await PGlite.create({ dataDir });
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    }
    console.log(`[db] local embedded Postgres ready at ${dataDir}`);
    return db;
  })();
  return g.__reuPg;
}

// PGlite runs one query at a time; chain calls so each function runs as its own transaction.
let queue: Promise<unknown> = Promise.resolve();

async function localRpc<T>(name: string, args: readonly (readonly [string, ArgType])[], params: Record<string, unknown>): Promise<T> {
  const db = await localDb();
  const values = args.map(([k, t]) => (t === "jsonb" ? JSON.stringify(params[k] ?? null) : (params[k] ?? null)));
  const sql = `select ${name}(${args.map(([k, t], i) => `${k} => $${i + 1}::${t}`).join(", ")}) as result`;
  const run = queue.then(() => db.query<{ result: T }>(sql, values));
  queue = run.catch(() => undefined);
  try {
    const res = await run;
    return res.rows[0]?.result as T;
  } catch (e) {
    console.error(`[db] ${name} failed`, e);
    throw new DbError(e instanceof Error ? e.message : String(e));
  }
}
