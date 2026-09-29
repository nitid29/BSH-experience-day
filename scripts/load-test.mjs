#!/usr/bin/env node
/**
 * Concurrency check against a running deployment (acceptance criterion 1).
 * Fires N simultaneous bookings at ONE session and verifies the database never exceeds
 * confirmed + waitlist capacity.
 *
 *   node scripts/load-test.mjs https://your-app.vercel.app 200 ovens_17001730
 *
 * Test bookings use addresses like loadtest-…@bshg.com. Remove them afterwards in the Supabase SQL editor:
 *   delete from registrations where email like 'loadtest-%@bshg.com';
 */
const [base = "http://localhost:3000", nArg = "200", session = "ovens_17001730"] = process.argv.slice(2);
const n = Number(nArg);
const run = Date.now().toString(36);

const before = await (await fetch(`${base}/api/availability`)).json();
const s0 = before.sessions.find((s) => s.id === session);
if (!s0) {
  console.error(`Unknown session "${session}". Available: ${before.sessions.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
console.log(`Session ${session}: capacity ${s0.confirmedCap} + ${s0.waitlistCap}, currently ${s0.confirmedCount} confirmed / ${s0.waitlistCount} waitlist`);
console.log(`Sending ${n} simultaneous bookings…`);

const t0 = Date.now();
const results = await Promise.all(
  Array.from({ length: n }, (_, i) =>
    fetch(`${base}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Load Test ${i}`, email: `loadtest-${run}-${i}@bshg.com`, sessionIds: [session] }),
    })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
      .catch((e) => ({ status: 0, body: { error: String(e) } })),
  ),
);
const tally = {};
for (const r of results) {
  const k = r.body?.ok ? r.body.outcomes[0].result : `${r.status}:${r.body?.outcomes?.[0]?.reason ?? r.body?.error}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log(`Done in ${Date.now() - t0} ms`, tally);

const after = (await (await fetch(`${base}/api/availability`)).json()).sessions.find((s) => s.id === session);
const regular = after.confirmedCount - after.forcedCount;
const ok = regular <= after.confirmedCap && after.waitlistCount <= after.waitlistCap;
console.log(`After: ${after.confirmedCount} confirmed / ${after.waitlistCount} waitlist → ${ok ? "PASS: capacity respected" : "FAIL: capacity exceeded"}`);
process.exit(ok ? 0 : 1);
