/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Database tests: run the real migration in an in-memory Postgres (PGlite) and exercise the
 * booking functions directly. `npm test`
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { DEFAULT_CONFIG, buildSessions } from "../lib/config";

let db: PGlite;

async function call<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<{ result: T }>(sql, params);
  return r.rows[0]?.result as T;
}
const book = (name: string, email: string, ids: string[]) =>
  call(`select book_sessions(p_name => $1, p_email => $2, p_session_ids => $3::text[]) as result`, [name, email, ids]);
const mine = (email: string) => call(`select get_my_bookings(p_email => $1) as result`, [email]);
const avail = async (id: string) =>
  (await call(`select get_availability() as result`)).sessions.find((s: any) => s.id === id);
const idOf = async (email: string, sid: string) =>
  (await db.query<{ id: string }>(`select id from registrations where email=$1 and session_id=$2`, [email, sid])).rows[0]?.id;

async function fill(sid: string, n: number, prefix: string) {
  for (let i = 0; i < n; i++) {
    const r = await book(`Person ${prefix}${i}`, `${prefix}${i}@bshg.com`, [sid]);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
}

before(async () => {
  db = await PGlite.create();
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(dir).sort()) await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  // Migration must be idempotent (it is re-run on every local start).
  for (const f of fs.readdirSync(dir).sort()) await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const res = await call(`select admin_apply_config(p_config => $1::jsonb, p_sessions => $2::jsonb) as result`, [
    JSON.stringify(DEFAULT_CONFIG),
    JSON.stringify(buildSessions(DEFAULT_CONFIG)),
  ]);
  assert.equal(res.ok, true);
});

test("config creates 2 plenary + 36 workshop + 1 gathering sessions", async () => {
  const a = await call(`select get_availability() as result`);
  assert.equal(a.sessions.length, 39);
  const g = a.sessions.find((s: any) => s.id === "gathering_17302000");
  assert.deepEqual([g.kind, g.confirmedCap, g.waitlistCap, g.label], ["social", 200, 0, "Gathering with Apéro & Pizza"]);
  const stx = a.sessions.find((s: any) => s.id === "stx_09301030");
  assert.equal(stx.confirmedCap, 50);
  const c = a.sessions.find((s: any) => s.id === "cooling_13001330");
  assert.deepEqual([c.confirmedCap, c.waitlistCap, c.state, c.room], [15, 10, "open", 5]);
});

test("booking normalises email and returns committed status", async () => {
  const r = await book("  Anna Schmidt ", "  Anna.Schmidt@BSHG.com ", ["stx_09301030", "ovens_13001330"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.outcomes.map((o: any) => o.result), ["confirmed", "confirmed"]);
  const m = await mine("anna.schmidt@bshg.com");
  assert.equal(m.name, "Anna Schmidt");
  assert.equal(m.bookings.length, 2);
  // a first-time assignment is not a promotion
  const rows = await db.query<any>(`select promoted_at from registrations where email='anna.schmidt@bshg.com'`);
  assert.ok(rows.rows.every((x) => x.promoted_at === null));
  const log = await db.query<any>(`select action from audit_log where email='anna.schmidt@bshg.com'`);
  assert.deepEqual(log.rows.map((x) => x.action), ["create", "create"]);
});

test("rules: one per topic, one per time, only one STX — across visits and within one request", async () => {
  const e = "rules@bshg.com";
  assert.equal((await book("Rule Tester", e, ["stx_09301030"])).ok, true);
  let r = await book("Rule Tester", e, ["stx_11001200"]);
  assert.equal(r.ok, false);
  assert.match(r.outcomes[0].reason, /only one of the two/);
  assert.equal((await book("Rule Tester", e, ["cooling_13001330"])).ok, true);
  r = await book("Rule Tester", e, ["ci_13001330"]); // same time row
  assert.equal(r.ok, false);
  assert.match(r.outcomes[0].reason, /already booked for Cooling at 13:00-13:30/);
  r = await book("Rule Tester", e, ["stx_11001200"]);
  assert.match(r.outcomes[0].reason, /the Strategy Update session at 09:30-10:30/, "full names, not short keys");
  r = await book("Rule Tester", e, ["cooling_14301500"]); // same topic again
  assert.match(r.outcomes[0].reason, /already booked for Cooling/);
  r = await book("Rule Tester", e, ["ovens_14301500", "dishcare_14301500"]); // clash inside one request
  assert.equal(r.ok, false);
  assert.equal((await mine(e)).bookings.length, 2, "nothing written on rejection");
});

test("capacity: 15 confirmed, 10 waitlist, then full", async () => {
  const sid = "laundrycare_13001330";
  await fill(sid, 15, "cap");
  assert.equal((await avail(sid)).state, "waitlist");
  await fill(sid, 10, "wl");
  const a = await avail(sid);
  assert.deepEqual([a.confirmedCount, a.waitlistCount, a.state], [15, 10, "full"]);
  const m = await mine("wl1@bshg.com");
  assert.deepEqual([m.bookings[0].status, m.bookings[0].waitlistPosition], ["waitlist", 2]);
  const r = await book("Late Comer", "late@bshg.com", [sid]);
  assert.equal(r.ok, false);
  assert.equal(r.outcomes[0].reason, "full");
});

test("all-or-nothing: one full session means nothing is saved", async () => {
  const r = await book("Batch Person", "batch@bshg.com", ["stx_11001200", "laundrycare_13001330"]);
  assert.equal(r.ok, false);
  assert.equal(r.outcomes.find((o: any) => o.sessionId === "stx_11001200").result, "ok");
  assert.equal((await mine("batch@bshg.com")).bookings.length, 0);
});

test("cancel promotes the first waitlisted person and flags them", async () => {
  const sid = "laundrycare_13001330";
  const id = await idOf("cap0@bshg.com", sid);
  // someone else's email cannot cancel it
  assert.equal((await call(`select cancel_booking(p_email => $1, p_booking_id => $2::uuid) as result`, ["x@bshg.com", id])).ok, false);
  const r = await call(`select cancel_booking(p_email => $1, p_booking_id => $2::uuid) as result`, ["CAP0@bshg.com", id]);
  assert.equal(r.ok, true);
  const p = (await db.query<any>(`select status, promoted_at from registrations where email='wl0@bshg.com'`)).rows[0];
  assert.equal(p.status, "confirmed");
  assert.ok(p.promoted_at);
  assert.equal((await mine("wl1@bshg.com")).bookings[0].waitlistPosition, 1);
  const log = await db.query<any>(`select action from audit_log where email='wl0@bshg.com' order by id`);
  assert.deepEqual(log.rows.map((x) => x.action), ["create", "promote"]);
});

test("direct inserts cannot bypass capacity (trigger) or rules (unique constraints)", async () => {
  await fill("laundrycare_13001330", 1, "refill"); // back to 15 + 10
  await assert.rejects(
    db.query(`insert into registrations (name,email,topic,session_id,time_slot) values ('Hack Er','hack@bshg.com','Laundry Care','laundrycare_13001330','13:00-13:30')`),
    /full/,
  );
  await assert.rejects(
    db.query(`insert into registrations (name,email,topic,session_id,time_slot) values ('Rule Tester','rules@bshg.com','STX','stx_11001200','11:00-12:00')`),
    /registrations_email_topic_key/,
  );
});

test("admin add: full session rejected unless seat is guaranteed; forced seat is confirmed over capacity", async () => {
  const sid = "laundrycare_13001330";
  let r = await call(`select admin_add(p_name=>$1,p_email=>$2,p_session_id=>$3,p_forced=>false) as result`, ["Vip Guest", "vip@bshg.com", sid]);
  assert.equal(r.ok, false);
  r = await call(`select admin_add(p_name=>$1,p_email=>$2,p_session_id=>$3,p_forced=>true) as result`, ["Vip Guest", "vip@bshg.com", sid]);
  assert.equal(r.ok, true);
  assert.equal(r.booking.status, "confirmed");
  const a = await avail(sid);
  assert.deepEqual([a.confirmedCount, a.forcedCount, a.waitlistCount, a.seatsLeft, a.state], [16, 1, 10, 0, "full"]);
  // nobody was demoted by the guaranteed seat
  const demotes = await db.query(`select 1 from audit_log where action='demote'`);
  assert.equal(demotes.rows.length, 0);
});

test("admin move: back of the new queue, promotion in the old session", async () => {
  const from = "laundrycare_13001330";
  const id = await idOf("cap5@bshg.com", from);
  const r = await call(`select admin_move(p_id=>$1::uuid,p_session_id=>$2,p_forced=>false) as result`, [id, "surfacevent_13001330"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.booking.status, "confirmed");
  assert.equal(r.promoted.length, 1);
  assert.equal(r.booking.promotedAt, null, "a move is not a promotion");
  // clash check excludes the person's own booking but applies to others
  const r2 = await call(`select admin_move(p_id=>$1::uuid,p_session_id=>$2,p_forced=>false) as result`, [id, "stx_09301030"]);
  assert.equal(r2.ok, true);
  const anna = await idOf("anna.schmidt@bshg.com", "ovens_13001330");
  const r3 = await call(`select admin_move(p_id=>$1::uuid,p_session_id=>$2,p_forced=>false) as result`, [anna, "stx_11001200"]);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /only one of the two/);
});

test("admin remove promotes and reports whom", async () => {
  const id = await idOf("cap6@bshg.com", "laundrycare_13001330");
  const r = await call(`select admin_remove(p_id=>$1::uuid) as result`, [id]);
  assert.equal(r.ok, true);
  // the guaranteed VIP seat is extra, so freeing a regular seat still promotes the next person
  assert.equal(r.promoted.length, 1);
  const again = await call(`select admin_remove(p_id=>$1::uuid) as result`, [id]);
  assert.equal(again.ok, false);
});

test("audit log is append-only", async () => {
  await assert.rejects(db.query(`delete from audit_log`), /append-only/);
  await assert.rejects(db.query(`update audit_log set action='create'`), /append-only/);
});

test("import is idempotent and re-derives statuses", async () => {
  const rows = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Imported One", email: "imp1@bshg.com", slotId: "cooling_17001730", ts: "2026-09-01T10:00:00Z", status: "waitlist" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Imported Two", email: "imp1@bshg.com", sessionId: "ovens_17001730" }, // clash → skipped
    { id: "not-a-uuid", name: "Bad", email: "bad@bshg.com", slotId: "cooling_17001730" },
  ];
  let r = await call(`select admin_import(p_rows=>$1::jsonb) as result`, [JSON.stringify(rows)]);
  assert.deepEqual([r.added, r.skipped], [1, 2]);
  r = await call(`select admin_import(p_rows=>$1::jsonb) as result`, [JSON.stringify(rows)]);
  assert.deepEqual([r.added, r.skipped], [0, 3]);
  assert.equal((await mine("imp1@bshg.com")).bookings[0].status, "confirmed");
});

test("capacity change via config re-derives (raising cap promotes waitlist)", async () => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.capacityOverrides = { laundrycare_13001330: { confirmedCap: 30 } };
  const r = await call(`select admin_apply_config(p_config => $1::jsonb, p_sessions => $2::jsonb) as result`, [
    JSON.stringify(cfg),
    JSON.stringify(buildSessions(cfg)),
  ]);
  assert.equal(r.promoted.length, 8); // the 8 still waiting after earlier promotions
  assert.equal((await avail("laundrycare_13001330")).waitlistCount, 0);
});

test("allowed email domains are enforced by the database", async () => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.registration.allowedEmailDomains = ["bshg.com"];
  await call(`select admin_apply_config(p_config => $1::jsonb, p_sessions => $2::jsonb) as result`, [JSON.stringify(cfg), JSON.stringify(buildSessions(cfg))]);
  assert.equal((await book("Outside Person", "someone@gmail.com", ["ci_17001730"])).error, "invalid_email");
  assert.equal((await book("Inside Person", "someone@bshg.com", ["ci_17001730"])).ok, true);
});

test("rate limiter", async () => {
  const hit = () => call<boolean>(`select rate_limit_hit(p_key=>'t',p_max=>3,p_window_seconds=>60) as result`);
  assert.deepEqual([await hit(), await hit(), await hit(), await hit()], [true, true, true, false]);
});

test("gathering: no waitlist, closes when full, can be combined with the 17:00 workshop", async () => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.capacityOverrides = { gathering_17302000: { confirmedCap: 2 } };
  await call(`select admin_apply_config(p_config => $1::jsonb, p_sessions => $2::jsonb) as result`, [JSON.stringify(cfg), JSON.stringify(buildSessions(cfg))]);
  const r = await book("Evening One", "eve1@bshg.com", ["cooling_17001730", "gathering_17302000"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.outcomes.map((o: any) => o.result), ["confirmed", "confirmed"]);
  assert.equal((await book("Evening Two", "eve2@bshg.com", ["gathering_17302000"])).ok, true);
  const a = await avail("gathering_17302000");
  assert.deepEqual([a.confirmedCount, a.waitlistCount, a.state], [2, 0, "full"]);
  const full = await book("Evening Three", "eve3@bshg.com", ["gathering_17302000"]);
  assert.equal(full.ok, false);
  assert.equal(full.outcomes[0].reason, "full");
  // cancelling frees the place again
  const id = await idOf("eve2@bshg.com", "gathering_17302000");
  assert.equal((await call(`select cancel_booking(p_email => $1, p_booking_id => $2::uuid) as result`, ["eve2@bshg.com", id])).ok, true);
  assert.equal((await book("Evening Three", "eve3@bshg.com", ["gathering_17302000"])).ok, true);
});
