# Product Requirements Document
# REU Experience Day — Event Registration Platform

**Owner:** Nitesh Malethia
**Client / Brand:** BSH (REU) — internal event
**Status:** Prototype complete (single-file HTML artifact, demo only). This PRD specifies the production build: a Next.js app on Vercel with a Supabase (Postgres) database.
**Document purpose:** Hand this to Claude Code (or another AI build tool) to build the production application. It contains the full functional spec, the data model, every edge case discovered during prototyping, and the complete prototype source code (Appendix A) so the build tool inherits the exact design language, copy, and interaction model.

---

## 1. Background & Context

### 1.1 What this is
REU Experience Day is an internal BSH event (target ~200 MCW colleagues from BUs, ST, CI, BA Controlling, POs) held on **27 October 2026** at **MCW**, running **09:30–20:00**. The day consists of:

- **Two identical STX Strategy Update plenary sessions** (09:30–10:30 and 11:00–12:00) — VCP deployment, Brand Portfolio & Consumer Journey Steering, Channel Management. Attendees pick **one** of the two.
- **Six product/insight workshop topics** run as **six parallel rooms** that rotate through all topics across six afternoon time slots (13:00–17:30). Topics: Surface/Vent, Dish Care, Laundry Care, Ovens, Cooling, CI (Consumer Insights).
- **An evening gathering** (17:30–20:00) with Apéro & Pizza. No registration needed.

Participants can register for all workshops or just a selection, **first come, first served**. Small groups (15 people per product workshop) keep sessions hands-on.

### 1.2 Why we need a production build
A working prototype exists as a **single self-contained HTML artifact** (Appendix A) using the browser/artifact key-value store for persistence. It is excellent for demonstrating the flow and design, but it is **not production-grade** for a 200-person event because the storage layer has no transactional guarantees. The specific failure modes we must eliminate are documented in Section 8 (Edge Cases) and Section 9 (Why a real backend).

### 1.3 Goals
- Let ~200 colleagues self-register in under a minute each, from their own laptops.
- Enforce real per-session capacity (15 seats for workshops, 50 for STX) with an automatic **waitlist** (10 per session) once full.
- Prevent double-booking / time clashes automatically.
- Give the organising team a live admin dashboard (registrations + capacity), CSV export, and reliable data that never silently disappears.
- Keep the BSH/REU visual identity exactly as in the prototype.

### 1.4 Non-goals
- Payment handling (the ~€40 cost is settled offline; do not build payments).
- SSO / corporate identity integration (email capture is sufficient unless the team later requests Azure AD).
- Native mobile apps (responsive web only).
- **Email verification for participants (magic links, one-time codes, passwords) is out of scope for v1.** Entering a name and email is enough to register. Verification may be added in a later phase (see 8.19).

---

## 2. Users & Roles

| Role | Who | Capabilities |
|---|---|---|
| **Participant** | ~200 MCW colleagues | Register with name + email, pick sessions and time slots, land on confirmed or waitlist, view their confirmation. |
| **Organiser (Admin)** | Small organising team | View all registrations, live capacity per session, confirmed/waitlist split, search/sort, export CSV, backup/restore. PIN- or auth-protected. |

There is no per-participant login/account in the prototype (email is the identifier). See Section 8.11 for the "edit / cancel my registration" decision the production build must make.

---

## 3. Core User Flow (Participant)

A four-step wizard with a persistent timetable always visible (sticky side panel on desktop, stacked on mobile).

**Step 1 — Details / sign-in by email.** Email first, then Full Name (required, min 2 chars). Email is the participant's identity: it is trimmed and lowercased before any comparison. While the user types a valid email that already has bookings, show "Welcome back — we found N bookings for this email" and prefill the stored name. "Continue" is disabled until both fields are valid. On Continue, load the latest data: a new email goes to Step 2; an email with bookings goes to the Manage screen.

**Manage screen (returning participant).** Title "Welcome back, <first name>". Lists every existing booking (topic, time, Confirmed or "Waitlist #n" with the person's queue position) with a **Cancel** button per booking (confirmation dialog; the freed seat goes to the next waitlisted person). Buttons: Back, and "Add more sessions" (hidden when every topic is already booked, with a note explaining how to switch a slot: cancel, then add again). An identity bar is shown on every step after Step 1: "Registering as <name> · <email>", a "My bookings (n)" link, and "Not you? Switch email", which clears the session.

**No verification (decided for v1).** Entering a valid email and a name takes the person straight into the registration flow. There is no magic link, code or password. The email is only used as the identifier that links a person's bookings together. Accepted risk: anyone who types a colleague's email can see and change that colleague's bookings (see 8.19).

**Step 2 — Topics.** Topics the person has already booked are shown as disabled cards tagged "✓ Booked · <time>" (with "(waitlist)" if applicable) and cannot be selected again. Select one or more of: the STX Strategy Update (shown as a distinct card, since it is a plenary with two identical sessions) and the six product workshops. Each card shows a one-line description and live availability ("N of 6 sessions with seats"). Multi-select.

**Step 3 — Time slots.** For each selected topic, show only its sessions:
- **STX:** choose exactly one of the two identical sessions (09:30 or 11:00). The user must never be able to book both, even though the two do not clash in time — including across separate visits.
- **Product workshops:** choose exactly one of the six time slots. Slots at a time the person is **already booked** (from an earlier visit) are disabled and labelled "booked: <topic>". Slots taken by another selection in the current flow are disabled as "clash". Full slots show a waitlist state (see Section 5).
- If no slot of a topic fits the person's schedule, say so and offer a one-click "Remove <topic> from this registration".
- If the user did not select STX and has not booked it, show a non-blocking info note explaining how to go back and add it.

**Step 4 — Confirm.** Show name, email, an "Adding now" list and (for returning participants) a muted "Already booked" list. Show each new session with its time and a **Confirmed / Waitlist** badge (predicted from live counts). If any session is waitlist, show an info note explaining what waitlist means. "Confirm registration" re-validates everything against the latest data (rules and capacity) and only then writes. If anything changed, nothing is saved: the user returns to Step 3 with an explanation per session. If a write fails, any part already written is rolled back and the user sees an error instead of a false success.

**Success screen.** Show **all** of the person's bookings (existing + new, new ones tagged "New") with final Confirmed/Waitlist status and a reminder about the 17:30 gathering. Offer "Manage my bookings" and "Register another participant" (resets the flow — the event is often registered on shared/kiosk laptops).

---

## 4. Timetable (authoritative data)

Always visible. Chronological order top-to-bottom: STX morning → afternoon workshop grid → evening gathering.

**Plenary (register for one):**
- 09:30–10:30 · STX Strategy Update · Session A
- 11:00–12:00 · STX Strategy Update · Session B

**Afternoon rotation grid** (rows = time, columns = Slot 1–6 = the six parallel rooms):

| Time | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 | Slot 6 |
|---|---|---|---|---|---|---|
| 13:00–13:30 | Surface/Vent | Dish Care | Laundry Care | Ovens | Cooling | CI |
| 13:45–14:15 | CI | Surface/Vent | Dish Care | Laundry Care | Ovens | Cooling |
| 14:30–15:00 | Cooling | CI | Surface/Vent | Dish Care | Laundry Care | Ovens |
| 15:30–16:00 | Ovens | Cooling | CI | Surface/Vent | Dish Care | Laundry Care |
| 16:15–16:45 | Laundry Care | Ovens | Cooling | CI | Surface/Vent | Dish Care |
| 17:00–17:30 | Dish Care | Laundry Care | Ovens | Cooling | CI | Surface/Vent |

**Evening (no registration):** 17:30–20:00 · Gathering with Apéro & Pizza.

Note: because every topic appears exactly once per time row, each topic runs six times across the afternoon. A participant attends at most one session of any given topic, and at most one session per time row (clash rule).

**Important production note:** the timetable, topics, capacities, date/venue, and PIN must be **configuration**, not hard-coded, so the team can reuse the tool for future events (see Section 7).

---

## 5. Capacity & Waitlist Rules (critical)

Per session instance:

| Session type | Confirmed capacity | Waitlist capacity |
|---|---|---|
| Product workshop (each of 36 instances) | 15 | 10 |
| STX plenary (each of 2 sessions) | 50 | 10 |

State machine for any session, where `count` = confirmed + waitlist registrations currently held:

- `count < confirmedCap` → **OPEN**. New registration = **confirmed**. Show "N seats left" (green > 50%, yellow ≤ 50%, red ≤ 20%).
- `confirmedCap ≤ count < confirmedCap + waitlistCap` → **WAITLIST**. New registration = **waitlist**. Show amber "Waitlist · N left".
- `count ≥ confirmedCap + waitlistCap` → **FULL**. Selection blocked.

**Status is assigned at write time**, computed against the live count at the moment of submission — never predicted-and-trusted from an earlier screen. If seats fill between step 3 and step 4, the participant is correctly recorded as waitlist and told so on the success screen.

**Status is derived from queue order (decided).** Within each session, bookings are ordered by `queuedAt` (admin-guaranteed seats first). The first `confirmedCap` are confirmed, the rest are waitlisted. Consequences:
- Removing or cancelling a confirmed booking **automatically promotes** the first waitlisted person. The promoted booking gets a `promotedAt` timestamp and a "Promoted" badge in the admin table (and, in production, a promotion email) so the organisers know whom to notify.
- A participant sees their waitlist position ("Waitlist #2").
- Moving a person to a different session gives them a new `queuedAt` (back of that queue) unless the admin guarantees the seat.
- Store the derived status on the row for exports, but always recompute it in the same transaction as any insert, delete or move.

---

## 6. Admin Dashboard

PIN-protected in the prototype (default PIN `2026`; the "Admin" button is always visible but opens a PIN modal). Production should replace the shared PIN with proper admin auth (Section 8.10).

Must contain:

The admin view uses the full page width (the timetable panel is hidden). Header metric counts **participants** (unique emails), not bookings.

1. **Registrations table** — one row per booking. Columns: Name, Email, Session, Time, Status (Confirmed / Waitlist #n, plus "Promoted" and "Override" badges), Registered (with "(admin)" if added by an organiser), **Actions: Move, Remove**. Searchable (name, email, session, time) and sortable (newest, session, time, status, name). "Refresh" reloads the latest data.
2. **Add person** — modal with Name, Email (prefills the name if the email already has bookings), Session (grouped by topic, each option showing live availability) and a checkbox "Guarantee a confirmed seat, even if this takes the session over capacity". The same rules as self-registration apply (one session per topic, one per time slot, only one STX). Without the checkbox, a full session (including waitlist) is rejected.
3. **Move** — modal showing the person's current session; pick a new session (same rules, the person's own current booking excluded from the clash check). Toast confirms the move and names anyone promoted from the waitlist of the session they left.
4. **Remove** — confirmation dialog; the next waitlisted person is promoted automatically and named in the toast ("Let them know").
5. **Capacity overview** — one row per session instance: Session · time, Confirmed (n/15 or n/50), Waitlist (n/10), live status pill, confirmed-fill bar.
6. **Exports & backup**
   - **Export CSV (one row per person)** — for sending invitations manually. Columns: Name, Email, Sessions booked (confirmed), Waitlisted sessions, Number of sessions. Sessions are listed chronologically as "Cooling (13:00-13:30); Ovens (14:30-15:00)".
   - **Detailed CSV** — one row per booking: Name, Email, Session, Time, Status, Waitlist position, Registered at, Added by, Promoted at, Seat guaranteed by admin.
   - Both CSVs are UTF-8 with BOM (umlauts open correctly in Excel) and neutralise cells starting with `= + - @` to prevent formula injection.
   - Backup JSON / Import JSON (idempotent by id; statuses are re-derived after import).

---

## 7. Configuration (make it reusable)

Externalize into a config object / admin settings screen:
- Event name, tagline, date, venue, day start/end.
- Logo assets (REU wave logo, BSH logo).
- Brand palette tokens (see Section 10).
- Topic list (key + description).
- STX session list (label + time + capacity).
- Time rows and the rotation grid.
- Confirmed and waitlist capacities (per type or per session).
- Admin credentials.

---

## 8. Edge Cases & Requirements the Production Build MUST Handle

These are the gaps between the prototype and a robust product. Each is a build requirement.

**8.1 Concurrent writes to the same session (the big one).**
Two people submitting for the last confirmed seat at the same instant must not both be confirmed beyond capacity. Requires an **atomic, server-side, transactional seat allocation** (e.g. a DB transaction with `SELECT ... FOR UPDATE` or an atomic counter / unique constraint on seat index). The prototype's last-write-wins key-value store cannot guarantee this. Capacity and waitlist limits must be enforced at the database, not just in the UI.

**8.2 Status assignment at commit, not at selection.**
As Section 5: recompute confirmed-vs-waitlist inside the same transaction that inserts the row, so it reflects the true count. Never trust the client's predicted status.

**8.3 Returning participants and duplicate bookings.**
Rules must hold across visits, not just within one form session. For one email: at most one booking per **topic** (so one STX session, and never the same workshop twice at different times) and at most one booking per **time slot**. The prototype enforces this in the UI and re-checks on submit and in every admin action; production must enforce it with database unique constraints (Section 12) so no request can bypass it.

**8.4 Time-clash enforcement server-side.**
The clash rule (one session per time row; STX single-choice) is enforced in the prototype UI only. The server must re-validate on submit so a crafted/stale request cannot create a clashing booking.

**8.5 STX "one of two" enforced server-side.**
A participant may hold at most one STX session across the two. Enforce with a unique constraint on `(email, "STX")` topic, or equivalent, in addition to the UI single-select.

**8.6 Partial submission failure.**
A registration for multiple sessions is effectively a batch. If one insert succeeds and another fails (capacity race), the user must get a clear, consistent result — either all-or-nothing, or a per-session result screen listing which succeeded, which fell to waitlist, and which failed. Do not leave the user thinking they got a seat they didn't. **Recommended:** process per-session, then show an explicit per-session outcome; never silently drop one.

**8.7 Data durability.**
No silent data loss, ever (this was the prototype's real-world failure — data vanished on tab close). Use a real persistent database with backups. Every registration write must be durable and acknowledged before the UI shows success.

**8.8 Email validation & normalization.**
Trim, lowercase for comparison/uniqueness, validate format. Consider restricting to the corporate domain(s) if the team wants (e.g. `@bshg.com`) — make it a config toggle.

**8.9 Waitlist promotion & cancellation.**
Decided: automatic promotion by queue order (Section 5), with a `promotedAt` flag and notification email. Admin add/move/remove and participant cancel all trigger re-derivation for the affected sessions inside one transaction.

**8.10 Admin authentication.**
Replace the client-side PIN with a **server-checked admin password**: stored as a Vercel environment variable, checked by a server route, never shipped to the browser. A successful login sets an HTTP-only session cookie (e.g. 12 hours). All admin actions (add, move, remove, export) run through server routes that check this cookie and use the Supabase service key; the service key is never exposed to the browser. Rate-limit login attempts.

**8.11 Edit / cancel by participant.**
Decided: participants can view their bookings, add more, and cancel individual bookings (Manage screen, Section 3). In v1 it is reachable by entering the email, without verification (Section 3).

**8.12 Confirmation email (optional for v1).**
The organisers plan to send invitations manually using the per-person CSV export. Automated confirmation and waitlist-promotion emails are nice-to-have: if built, send one email per person listing all their sessions with confirmed/waitlist status (calendar invite optional).

**8.13 Accessibility.**
Keyboard navigation, focus states, ARIA labels on the wizard steps, sufficient contrast (BSH palette already supports this), `prefers-reduced-motion` respected (prototype already does). Maintain in production.

**8.14 Timezone / date correctness.**
Store timestamps in UTC; display in the event's local timezone. Don't rely on the client clock for ordering waitlists — use server time.

**8.15 Live seat counts from Supabase (required).**
Every capacity number in the UI ("N seats left", "Waitlist · N left", "Full", "N of 6 sessions with seats", "Waitlist #n", the admin capacity table and the header participant count) must come from the Supabase database, never from counts kept in the browser.
- **Source:** a database view or function (e.g. `get_availability()`) returning, per session, confirmed count, waitlist count, capacities and state (open / waitlist / full). It returns counts only, never names or emails.
- **When to fetch:** on page load, on entering Steps 2, 3 and 4, and on returning to the Manage screen.
- **Keep it live while the person is choosing:** on Steps 2–4, subscribe to changes with Supabase Realtime on the registrations table and re-fetch availability when anything changes. If Realtime isn't used, poll every 10–15 seconds. The admin dashboard refreshes the same way.
- **Update without disrupting the user:** refresh numbers in place; do not reset the user's selections. If a slot the user has selected becomes full, mark it clearly ("just filled up") and ask them to choose again.
- **The database decides at submit:** the booking function re-checks capacity and rules inside the transaction and returns the actual outcome per session (confirmed / waitlist / rejected with reason). The success screen shows that outcome, not the earlier prediction.

**8.16 Empty / full states.**
Clean empty state for admin (no registrations yet), clean "session full / event full" states for participants, and a graceful "everything you selected is full" path.

**8.17 Input abuse / spam.**
Basic rate limiting and honeypot / lightweight bot protection on the public form, since the link is shared widely internally.

**8.18 Audit trail.**
Keep an immutable log of registration create/cancel/promote events for the organising team to reconcile the final attendee list.

**8.19 No participant verification (accepted v1 risk).**
Because v1 has no email verification, the database must still protect privacy:
- The browser never reads the registrations table directly. Row-level security denies all direct access for anonymous users.
- Participants interact only through database functions: `get_availability()` (counts only), `get_my_bookings(email)` (that email's own bookings: topic, time, status, waitlist position), `book_sessions(name, email, session_ids)` and `cancel_booking(email, booking_id)`, which only cancels if the booking belongs to that email.
- No function returns other people's names or emails; that data is only visible in the admin dashboard.
- Mistyped emails create a separate "person". Show the email prominently on the confirm and success screens so people catch typos.
- If misuse becomes a problem, add email verification in a later phase (Supabase Auth with a code or link).

---

## 9. Why a Real Backend (context for the build tool)

The prototype persists to the artifact's `window.storage` key-value store. It works for a demo and even for a handful of users, but it has: no transactions (concurrent seat grabs can overwrite each other — last-write-wins), no server-enforced capacity, no uptime guarantees, no email, and (as experienced) a real risk of data loss. A seat-locking scheme layered on the same store does not fix this — it just moves the same race condition to the lock. For ~200 colleagues with guaranteed allocation, the correct architecture is a small web app with a transactional database.

---

## 10. Design System (must be preserved)

**Brand:** BSH corporate identity. REU Experience Day sub-brand ("Explore and Connect.").

**Palette (BSH corporate):**
- Primary — Outrageous Orange `#FF6840` (most prominent color; buttons, selected states, highlights, subtitle). Never mixed directly against a secondary accent.
- Neutrals — Black `#000000`, White `#FFFFFF`, gray scale `#F5F5F5`, `#E0E0E0`, `#BCBCBC`, `#969696`, `#666666`, `#262626`.
- Secondary accent — **only one used:** Viking Blue `#73C1DA` (STX plenary card + morning info box). Other secondaries exist in the BSH system (Yellow `#FFCA29`, Red `#E73E3E`, Denim `#1672CD`, Sea Green `#319D63`, Violet `#882E99`) but must not be combined; the app uses Sea Green/Yellow/Red only as functional status colors for seats.
- Rules: flat, opaque fills; no multi-color gradients; text in black, white, or orange; logos stay black or white (never recolored).

**Typography:** Segoe UI / system sans stack. Clean, Microsoft/Fluent-inspired, minimal.

**Layout:** White background, subtle gray structure, generous spacing, rounded 6px corners, soft shadows. Two-column shell (form + sticky timetable) collapsing to a single column under 1120px. Header carries the REU wave logo (left) and the BSH logo (right).

**Logos:** Two PNG assets, embedded in the prototype as base64 (replaced with placeholders in Appendix A — supply the real files in production): the REU three-wave mark and the BSH `B/S/H/` wordmark.

**Status color semantics:**
- Green (`#319D63`) — plenty of confirmed seats.
- Yellow (`#FFCA29` family) — few confirmed seats / waitlist state (amber).
- Red (`#E73E3E`) — almost full.
- Gray — full / disabled.

---

## 11. Tech Stack (decided)

- **Hosting & app:** Next.js (React) + Tailwind on **Vercel** (free `*.vercel.app` subdomain), mirroring the prototype's components and tokens.
- **Database:** Vercel does not provide its own database; connect one from the Vercel Marketplace. Use **Supabase (Postgres), EU region (Frankfurt)**: it provides the database, row-level security, database functions and Realtime updates for live seat counts. Neon is an alternative Postgres host, but would need polling instead of Realtime. Implement seat allocation as a Postgres function called in a transaction (lock the session row, count, insert, derive status).
- **Email (optional for v1):** a transactional provider (e.g. Resend) for confirmations and waitlist promotions. If not built, the organisers send invitations manually from the per-person CSV. Send from a domain that BSH mail filters accept, or confirmations will land in spam.
- **Before launch:** confirm with BSH IT / works council that an externally hosted tool may store employee names and emails; add a privacy notice and a deletion date after the event.

Fallback if hosting is not approved: a Google Apps Script web app backed by a Google Sheet, using LockService to serialize writes.

---

## 12. Data Model (reference)

**Registration**
```
id            (uuid, PK)
name          (string)
email         (string, stored trimmed + lowercased)
topic         (string: "STX" | "Surface/Vent" | "Dish Care" | "Laundry Care" | "Ovens" | "Cooling" | "CI")
sessionId     (string, FK: e.g. "cooling_13001330", "stx_09301030")
timeSlot      (string, e.g. "13:00-13:30")
status        (enum: "confirmed" | "waitlist")   // derived, stored for exports
queuedAt      (timestamp, UTC)   // position in the session queue; reset on move
forced        (bool)             // admin-guaranteed seat, may exceed capacity
source        (enum: "self" | "admin")
promotedAt    (timestamp, nullable)
movedAt       (timestamp, nullable)
createdAt     (timestamp, UTC, server-assigned)
```

**Session (config-derived, or a table)**
```
id            (string, PK)
topic         (string)
timeSlot      (string)
confirmedCap  (int)             // 15 workshops, 50 STX
waitlistCap   (int)             // 10
```

Constraints/indexes: unique `(email, sessionId)`; unique `(email, topic)` (covers "only one STX" and "same workshop once"); unique `(email, timeSlot)` (no clashes); index on `(sessionId, queuedAt)`. Capacity and status derivation run inside the same transaction as every insert, delete and move.

---

## 13. Acceptance Criteria (production)

1. 200 concurrent registrations never exceed any session's confirmed+waitlist capacity.
2. No participant can hold two sessions in the same time row, or both STX sessions.
3. Confirmed/waitlist status is always correct and assigned transactionally at commit.
4. No registration is ever lost; all writes are durable and acknowledged.
5. Admin can view, search, sort, and export all registrations with correct status, and see live capacity.
6. Participants see an on-screen confirmation reflecting their confirmed/waitlist status (confirmation emails are optional for v1; see 8.12).
7. Admin can add, move and remove people; removals and cancellations promote the next waitlisted person automatically and flag them.
8. The UI matches the prototype's design language, copy, and BSH palette.
9. Fully responsive and keyboard-accessible.
10. Timetable, capacities, topics, date/venue, and admin credentials are configurable without code changes.
11. A returning participant (same email, no verification) sees all existing bookings, can add sessions without clashes, and can cancel bookings.
12. The per-person CSV lists each participant once with confirmed and waitlisted sessions.
13. All seat counts shown to participants and admins come from Supabase and update within ~15 seconds of any booking, cancellation or admin change, without resetting the user's selections.

---

## Appendix A — Complete Prototype Source (single-file HTML artifact)

This is the exact prototype built and iterated with the client. It encodes the design language, copy, wizard flow, timetable, waitlist state machine, clash logic, and admin dashboard. **The two logo images are represented as `{{REU_WAVE_LOGO_PNG_BASE64}}` and `{{BSH_LOGO_PNG_BASE64}}` placeholders** — in the prototype these are full base64 PNG data URIs; supply the real asset files in production. Use this as the reference implementation for UI, states, and copy; replace the storage layer per Sections 8–9.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>REU Experience Day — Registration</title>
<style>
:root{
  --orange:#FF6840;--orange-soft:#FFF0EB;--orange-dark:#D9502A;--orange-muted:#C8583A;
  --accent:#73C1DA;--accent-soft:#E8F5FA;
  --ink:#000000;--ink-2:#666666;--ink-3:#969696;
  --line:#E0E0E0;--bg:#FFFFFF;--bg-2:#F5F5F5;
  --green:#319D63;--green-bg:#EAF5EF;
  --yellow:#FFCA29;--yellow-bg:#FFF8E1;
  --red:#E73E3E;--red-bg:#FDECEC;
  --radius:6px;
  --shadow:0 1.6px 3.6px rgba(0,0,0,.08),0 .3px .9px rgba(0,0,0,.06);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased;}
button{font:inherit;cursor:pointer;}input{font:inherit;}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}

header{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:50;}
.header-inner{max-width:1260px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
@media(max-width:520px){.reg-count{display:none;}.bsh-divider{display:none;}}
.brandmark{flex:none;display:flex;align-items:center;}
.brandmark img{height:36px;width:auto;}
.brand-title{font-size:1.05rem;font-weight:600;color:var(--ink);}
.brand-sub{font-size:.78rem;color:var(--orange);font-style:italic;font-weight:600;}
.header-spacer{flex:1;}
.header-right{display:flex;gap:10px;align-items:center;}
.bsh-divider{width:1px;height:26px;background:var(--line);margin:0 4px;}
.bsh-logo{height:22px;width:auto;}
.reg-count{font-size:.8rem;color:var(--ink-2);background:var(--bg-2);padding:4px 12px;border-radius:99px;font-weight:600;}
.btn-ghost{background:none;border:1px solid var(--line);border-radius:var(--radius);padding:7px 14px;font-size:.82rem;color:var(--ink);font-weight:600;}
.btn-ghost:hover{background:var(--bg-2);}

.shell{max-width:1400px;margin:0 auto;padding:24px 24px 80px;display:grid;grid-template-columns:minmax(0,1fr) 620px;gap:28px;align-items:start;}
@media(max-width:1120px){.shell{grid-template-columns:1fr;}.timetable-panel{position:static!important;order:-1;}}

/* Timetable */
.timetable-panel{position:sticky;top:72px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);overflow:hidden;}
.tt-head{padding:14px 16px 10px;border-bottom:1px solid var(--line);}
.tt-head h2{font-size:.92rem;font-weight:600;}
.tt-head p{font-size:.75rem;color:var(--ink-2);margin-top:2px;}
.tt-info{margin:10px 14px 0;padding:9px 12px;border-radius:var(--radius);font-size:.78rem;border:1px solid;}
.tt-info.plenary{background:var(--accent-soft);border-color:#B5DCE9;color:#262626;}
.tt-info.social{background:var(--orange-soft);border-color:#F5C9B8;color:#262626;}
.tt-info strong{display:block;font-size:.8rem;}
.tt-table-wrap{padding:10px 14px 14px;overflow-x:auto;}
table.tt{border-collapse:collapse;width:100%;font-size:.74rem;table-layout:fixed;}
table.tt th,table.tt td{padding:6px 6px;border:1px solid var(--line);text-align:left;white-space:normal;word-break:break-word;line-height:1.25;}
table.tt col.c-time{width:74px;}
table.tt thead th{background:var(--bg-2);font-weight:600;font-size:.7rem;color:var(--ink-2);}
table.tt td.time{font-weight:600;background:var(--bg-2);color:var(--ink);}
table.tt td.hl{background:var(--orange-soft);font-weight:600;color:var(--orange-dark);}
.tt-legend{padding:0 14px 12px;font-size:.7rem;color:var(--ink-3);}
.tt-legend .dot{display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--orange-soft);border:1px solid #F5C9B8;vertical-align:-1px;margin-right:4px;}

/* Steps */
.stepper{display:flex;gap:0;margin-bottom:22px;border-bottom:1px solid var(--line);}
.step-tab{padding:10px 4px;margin-right:22px;font-size:.82rem;color:var(--ink-3);border-bottom:2px solid transparent;font-weight:600;display:flex;align-items:center;gap:7px;}
.step-tab .num{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--ink-3);display:grid;place-items:center;font-size:.68rem;flex:none;}
.step-tab.active{color:var(--ink);border-bottom-color:var(--orange);}
.step-tab.active .num{border-color:var(--orange);background:var(--orange);color:#fff;}
.step-tab.done{color:var(--ink-2);}
.step-tab.done .num{border-color:var(--green);background:var(--green);color:#fff;}
@media(max-width:640px){.step-tab .lbl{display:none;}.step-tab{margin-right:12px;}}

.panel{animation:fadein .2s ease;}
@keyframes fadein{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
.panel h1{font-size:1.4rem;font-weight:600;margin-bottom:4px;}
.event-meta{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px;}
.meta-pill{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:600;color:#262626;background:var(--bg-2);border:1px solid var(--line);border-radius:99px;padding:4px 12px;}
.meta-pill .mp-ico{font-size:.85rem;line-height:1;}
.panel .lede{color:var(--ink-2);font-size:.9rem;margin-bottom:20px;max-width:56ch;}

/* Forms */
.field{margin-bottom:16px;max-width:420px;}
.field label{display:block;font-size:.84rem;font-weight:600;margin-bottom:5px;}
.field input{width:100%;padding:9px 12px;border:1px solid #BCBCBC;border-radius:var(--radius);font-size:.92rem;}
.field input:focus{outline:2px solid var(--orange);outline-offset:-1px;border-color:var(--orange);}
.field .hint{font-size:.76rem;color:var(--red);margin-top:4px;display:none;}
.field.invalid input{border-color:var(--red);}
.field.invalid .hint{display:block;}

.btn-row{display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;}
.btn-primary{background:var(--orange);color:#fff;border:none;border-radius:var(--radius);padding:10px 22px;font-weight:600;font-size:.9rem;transition:background .12s;}
.btn-primary:hover{background:var(--orange-dark);}
.btn-primary:disabled{background:#BCBCBC;cursor:not-allowed;}
.btn-secondary{background:#fff;color:var(--ink);border:1px solid #BCBCBC;border-radius:var(--radius);padding:10px 22px;font-weight:600;font-size:.9rem;}
.btn-secondary:hover{background:var(--bg-2);}
button:focus-visible,input:focus-visible{outline:2px solid var(--orange);outline-offset:2px;}

/* Workshop cards */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.ws-card{text-align:left;border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;display:flex;flex-direction:column;gap:6px;position:relative;transition:border-color .12s,box-shadow .12s;}
.ws-card:hover{border-color:#BCBCBC;box-shadow:var(--shadow);}
.ws-card.selected{border-color:var(--orange);box-shadow:0 0 0 1px var(--orange);}
.ws-card .check{position:absolute;top:12px;right:12px;width:20px;height:20px;border-radius:50%;border:1.5px solid #BCBCBC;display:grid;place-items:center;color:#fff;font-size:.66rem;}
.ws-card.selected .check{background:var(--orange);border-color:var(--orange);}
.ws-card h3{font-size:.95rem;font-weight:600;padding-right:26px;}
.ws-card p{font-size:.78rem;color:var(--ink-2);}
.ws-card .meta{font-size:.72rem;color:var(--ink-3);margin-top:auto;}
.ws-card.stx{border-color:var(--accent);background:var(--accent-soft);}
.ws-card.stx.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);}
.ws-card.stx .check.on{background:var(--accent);border-color:var(--accent);}

/* Slot selection */
.note-box{display:flex;gap:10px;align-items:flex-start;background:var(--accent-soft);border:1px solid #B5DCE9;border-radius:var(--radius);padding:11px 14px;margin-bottom:20px;font-size:.82rem;color:#262626;max-width:640px;}
.note-box .note-icon{flex:none;width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:.7rem;font-weight:700;font-style:italic;margin-top:1px;}
.note-box strong{font-weight:600;}
.note-box.wait{background:var(--yellow-bg);border-color:#F0D97A;}
.note-box.wait .note-icon{background:#E0A800;}
.status-badge{display:inline-block;font-size:.66rem;font-weight:700;padding:1px 7px;border-radius:99px;vertical-align:middle;text-transform:uppercase;letter-spacing:.02em;}
.status-badge.wait{background:var(--yellow-bg);color:#8A6D00;border:1px solid #F0D97A;}
.status-badge.conf{background:var(--green-bg);color:var(--green);}
.slot-group{margin-bottom:24px;}
.slot-group h3{font-size:.98rem;font-weight:600;margin-bottom:2px;}
.slot-group .sub{font-size:.78rem;color:var(--ink-2);margin-bottom:8px;}
.slot-list{display:flex;flex-wrap:wrap;gap:8px;}
.slot-btn{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:var(--radius);background:#fff;padding:8px 14px;font-size:.84rem;font-weight:600;color:var(--ink);transition:border-color .12s;}
.slot-btn:hover:not(:disabled){border-color:#BCBCBC;}
.slot-btn.selected{border-color:var(--orange);box-shadow:0 0 0 1px var(--orange);background:var(--orange-soft);}
.slot-btn.waitlist{border-color:#F0D97A;background:var(--yellow-bg);}
.slot-btn.waitlist.selected{border-color:#E0A800;box-shadow:0 0 0 1px #E0A800;background:#FFF3CC;}
.slot-btn:disabled{color:var(--ink-3);background:var(--bg-2);cursor:not-allowed;text-decoration:line-through;}
.seat-pill{font-size:.68rem;font-weight:600;padding:2px 7px;border-radius:99px;text-decoration:none!important;}
.seat-pill.green{background:var(--green-bg);color:var(--green);}
.seat-pill.yellow{background:var(--yellow-bg);color:var(--yellow);}
.seat-pill.red{background:var(--red-bg);color:var(--red);}
.seat-pill.full{background:var(--bg-2);color:var(--ink-3);}
.seat-pill.wait{background:var(--yellow-bg);color:#8A6D00;border:1px solid #F0D97A;}

/* Summary */
.summary-box{border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);max-width:520px;overflow:hidden;}
.summary-box .row{display:flex;justify-content:space-between;gap:16px;padding:11px 18px;border-bottom:1px solid var(--line);font-size:.88rem;}
.summary-box .row:last-child{border-bottom:none;}
.summary-box .row .k{color:var(--ink-2);flex:none;}
.summary-box .row .v{font-weight:600;text-align:right;}
.summary-ws{padding:6px 18px 14px;}
.summary-ws .k{font-size:.88rem;color:var(--ink-2);padding:6px 0 4px;}
.summary-ws .item{display:flex;justify-content:space-between;font-size:.88rem;font-weight:600;padding:6px 0;border-top:1px dashed var(--line);}
.summary-ws .item span:last-child{color:var(--orange-dark);}

/* Success */
.success{max-width:520px;border:1px solid var(--line);border-radius:8px;padding:32px;text-align:center;box-shadow:var(--shadow);animation:fadein .3s;}
.success .tick{width:52px;height:52px;border-radius:50%;background:var(--green-bg);color:var(--green);display:grid;place-items:center;font-size:1.4rem;margin:0 auto 14px;}
.success h1{font-size:1.25rem;margin-bottom:4px;}
.success p{color:var(--ink-2);font-size:.88rem;margin-bottom:6px;}
.success .booked{margin:16px 0;text-align:left;border-top:1px solid var(--line);}
.success .booked .item{display:flex;justify-content:space-between;padding:9px 4px;border-bottom:1px solid var(--line);font-size:.88rem;font-weight:600;}
.success .booked .item span:last-child{color:var(--orange-dark);}

/* Admin */
.admin h1{font-size:1.4rem;font-weight:600;margin-bottom:4px;}
.admin .lede{color:var(--ink-2);font-size:.88rem;margin-bottom:20px;}
.admin-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px;}
.admin-tools input[type=search]{padding:7px 12px;border:1px solid #BCBCBC;border-radius:var(--radius);font-size:.85rem;min-width:210px;}
.admin-tools select{padding:7px 10px;border:1px solid #BCBCBC;border-radius:var(--radius);font:inherit;font-size:.83rem;background:#fff;}
.tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);margin-bottom:26px;}
table.data{border-collapse:collapse;width:100%;font-size:.82rem;}
table.data th{text-align:left;padding:9px 12px;background:var(--bg-2);border-bottom:1px solid var(--line);font-size:.73rem;color:var(--ink-2);font-weight:600;white-space:nowrap;}
table.data th.sortable{cursor:pointer;user-select:none;}
table.data th.sortable:hover{color:var(--ink);}
table.data td{padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap;}
table.data tr:last-child td{border-bottom:none;}
table.data tr:hover td{background:#FBFBFB;}
.empty{padding:40px 20px;text-align:center;color:var(--ink-2);font-size:.88rem;}
.empty .icon{font-size:1.5rem;margin-bottom:6px;color:var(--ink-3);}
.cap-bar{height:6px;border-radius:3px;background:var(--line);min-width:80px;overflow:hidden;}
.cap-bar i{display:block;height:100%;border-radius:3px;}
.section-h{font-size:1rem;font-weight:600;margin:6px 0 10px;}

/* PIN modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:100;display:grid;place-items:center;animation:fadein .15s;}
.modal{background:#fff;border-radius:10px;padding:28px 32px;max-width:340px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,.18);text-align:center;}
.modal h2{font-size:1.1rem;margin-bottom:4px;}
.modal p{font-size:.85rem;color:var(--ink-2);margin-bottom:16px;}
.modal input{width:100%;padding:10px;border:1px solid #BCBCBC;border-radius:var(--radius);font-size:1.1rem;text-align:center;letter-spacing:.3em;}
.modal input:focus{outline:2px solid var(--orange);border-color:var(--orange);}
.modal .err{font-size:.8rem;color:var(--red);margin-top:8px;min-height:1.2em;}
.modal .btn-row{margin-top:14px;justify-content:center;}

/* Identity bar + returning user */
.id-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.8rem;color:var(--ink-2);background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius);padding:7px 12px;margin-bottom:16px;}
.id-bar strong{color:var(--ink);font-weight:600;}
.link-btn{background:none;border:none;padding:0;color:var(--orange-dark);font-weight:600;font-size:inherit;text-decoration:underline;text-underline-offset:2px;}
.link-btn:hover{color:var(--orange);}
.found-hint{font-size:.78rem;color:var(--green);margin-top:5px;font-weight:600;}
.bookings{border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);max-width:600px;overflow:hidden;margin-bottom:6px;}
.bookings .b-row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--line);font-size:.88rem;}
.bookings .b-row:last-child{border-bottom:none;}
.bookings .b-topic{font-weight:600;flex:1;min-width:0;}
.bookings .b-time{color:var(--orange-dark);font-weight:600;white-space:nowrap;}
.btn-small{background:#fff;border:1px solid #BCBCBC;border-radius:var(--radius);padding:4px 10px;font-size:.76rem;font-weight:600;color:var(--ink);white-space:nowrap;}
.btn-small:hover{background:var(--bg-2);}
.btn-small.danger{color:var(--red);border-color:#F2B8B8;}
.btn-small.danger:hover{background:var(--red-bg);}
.list-label{font-size:.78rem;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.03em;margin:4px 0 8px;}
.ws-card.booked{background:var(--bg-2);border-style:dashed;cursor:default;}
.ws-card.booked:hover{box-shadow:none;border-color:var(--line);}
.ws-card.booked h3,.ws-card.booked p{color:var(--ink-3);}
.ws-card .booked-tag{font-size:.72rem;font-weight:600;color:var(--green);margin-top:auto;}
.ws-card .booked-tag.wl{color:#8A6D00;}
.summary-ws .item.existing{color:var(--ink-3);}
.summary-ws .item.existing span:last-child{color:var(--ink-3);}
.error-box{display:flex;gap:10px;align-items:flex-start;background:var(--red-bg);border:1px solid #F2B8B8;border-radius:var(--radius);padding:11px 14px;margin-bottom:18px;font-size:.84rem;color:#262626;max-width:640px;}
.storage-banner{background:var(--red-bg);border-bottom:1px solid #F2B8B8;color:#262626;font-size:.82rem;padding:8px 24px;text-align:center;}

/* Admin actions + modal forms */
.row-actions{display:flex;gap:6px;}
.status-badge.promo{background:var(--orange-soft);color:var(--orange-dark);border:1px solid #F5C9B8;margin-left:4px;}
.status-badge.forced{background:var(--bg-2);color:var(--ink-2);border:1px solid var(--line);margin-left:4px;}
.modal.wide{max-width:460px;text-align:left;}
.modal.wide h2{margin-bottom:2px;}
.modal .mfield{margin-bottom:12px;}
.modal .mfield label{display:block;font-size:.8rem;font-weight:600;margin-bottom:4px;}
.modal .mfield input,.modal .mfield select{width:100%;padding:8px 10px;border:1px solid #BCBCBC;border-radius:var(--radius);font:inherit;font-size:.88rem;letter-spacing:normal;text-align:left;background:#fff;}
.modal .mfield input:focus,.modal .mfield select:focus{outline:2px solid var(--orange);outline-offset:-1px;border-color:var(--orange);}
.modal .mcheck{display:flex;gap:8px;align-items:flex-start;font-size:.8rem;color:var(--ink-2);margin:4px 0 6px;}
.modal .mcheck input{width:auto;margin-top:3px;}
.modal .current{font-size:.84rem;background:var(--bg-2);border-radius:var(--radius);padding:8px 10px;margin-bottom:12px;}
.modal .btn-row{justify-content:flex-end;}
.btn-danger{background:var(--red);color:#fff;border:none;border-radius:var(--radius);padding:10px 22px;font-weight:600;font-size:.9rem;}
.btn-danger:hover{background:#C93232;}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#262626;color:#fff;font-size:.84rem;padding:11px 18px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:200;max-width:min(560px,92vw);animation:fadein .2s;}
table.tt td.bk{background:var(--green-bg);font-weight:600;color:var(--green);}
.tt-legend .dot.bk{background:var(--green-bg);border-color:#A9D8BC;}

body.is-admin .shell{grid-template-columns:1fr;}
body.is-admin .timetable-panel{display:none;}
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="brandmark"><img src="{{REU_WAVE_LOGO_PNG_BASE64}}" alt="REU Experience Day"></div>
    <div>
      <div class="brand-title">REU Experience Day</div>
      <div class="brand-sub">Explore and Connect.</div>
    </div>
    <div class="header-spacer"></div>
    <div class="header-right">
      <span class="reg-count" id="regCount">0 participants</span>
      <button class="btn-ghost" id="adminBtn" onclick="openAdmin()">Admin</button>
      <button class="btn-ghost" id="backBtn" style="display:none" onclick="closeAdmin()">← Registration</button>
      <span class="bsh-divider"></span>
      <img class="bsh-logo" src="{{BSH_LOGO_PNG_BASE64}}" alt="BSH">
    </div>
  </div>
</header>

<div class="shell">
  <main id="mainCol"></main>
  <aside class="timetable-panel" aria-label="Full workshop timetable">
    <div class="tt-head">
      <h2>Session timetable · 27 October 2026</h2>
      <p>Six parallel rooms rotate through all topics. 15 seats each — a waitlist opens once a session is full.</p>
    </div>
    <div class="tt-info plenary">
      <strong>09:30–10:30 &amp; 11:00–12:00 · STX Strategy Update</strong>
      VCP deployment, Brand Portfolio, Channel Management. Two identical sessions — register for one.
    </div>
    <div class="tt-table-wrap"><table class="tt" id="ttTable"></table></div>
    <div class="tt-legend" id="ttLegend" style="display:none"><span class="dot"></span>Your selected topics</div>
    <div class="tt-info social" style="margin-bottom:14px">
      <strong>17:30–20:00 · Gathering with Apéro &amp; Pizza</strong>
      Cross-departmental get-together. No registration needed.
    </div>
  </aside>
</div>

<div id="modalRoot"></div>

<script>
/* ===== DATA ===== */
const WORKSHOPS = [
  {key:"Surface/Vent", desc:"Cooktops and ventilation: portfolio direction, connected features and category roadmap.", cap:15},
  {key:"Dish Care",    desc:"Dishwashers: efficiency programs, Zeolith drying and the next platform generation.", cap:15},
  {key:"Laundry Care", desc:"Washers and dryers: i-DOS dosing, sustainability targets and lineup strategy.", cap:15},
  {key:"Ovens",        desc:"Built-in ovens: sensor cooking, steam functions and premium segment positioning.", cap:15},
  {key:"Cooling",      desc:"Refrigeration: VitaFresh, energy labels and the connected cooling roadmap.", cap:15},
  {key:"CI",           desc:"Consumer Insights and use cases: latest research on buying behavior and category perception.", cap:15},
];
const STX_SESSIONS = [
  {key:"STX", time:"09:30-10:30", label:"STX Strategy Update · Session A", cap:50},
  {key:"STX", time:"11:00-12:00", label:"STX Strategy Update · Session B", cap:50},
];
const TIMES=["13:00-13:30","13:45-14:15","14:30-15:00","15:30-16:00","16:15-16:45","17:00-17:30"];
const GRID=[
  ["Surface/Vent","Dish Care","Laundry Care","Ovens","Cooling","CI"],
  ["CI","Surface/Vent","Dish Care","Laundry Care","Ovens","Cooling"],
  ["Cooling","CI","Surface/Vent","Dish Care","Laundry Care","Ovens"],
  ["Ovens","Cooling","CI","Surface/Vent","Dish Care","Laundry Care"],
  ["Laundry Care","Ovens","Cooling","CI","Surface/Vent","Dish Care"],
  ["Dish Care","Laundry Care","Ovens","Cooling","CI","Surface/Vent"],
];
const ALL_TOPICS=["STX",...WORKSHOPS.map(w=>w.key)];
const WAITLIST_CAP=10;
const ADMIN_PIN="2026";

function slotId(ws,t){return ws.toLowerCase().replace(/[^a-z0-9]/g,"")+"_"+t.replace(/[:-]/g,"");}
function buildSlotDefs(){
  const defs=[];
  STX_SESSIONS.forEach(s=>defs.push({id:slotId(s.key,s.time),workshop:s.key,time:s.time,label:s.label,cap:s.cap,wcap:WAITLIST_CAP}));
  WORKSHOPS.forEach(w=>TIMES.forEach(t=>defs.push({id:slotId(w.key,t),workshop:w.key,time:t,cap:w.cap,wcap:WAITLIST_CAP})));
  return defs;
}
const SLOT_DEFS=buildSlotDefs();
function slotDef(sid){return SLOT_DEFS.find(s=>s.id===sid);}
function topicLabel(t){return t==="STX"?"STX Strategy Update":t;}
function sessionLabel(sid){const d=slotDef(sid);return d?`${topicLabel(d.workshop)} · ${d.time}`:sid;}

/* ===== HELPERS ===== */
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function validEmail(e){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}
function normEmail(e){return String(e||"").trim().toLowerCase();}
function uid(){try{return crypto.randomUUID();}catch(e){return "r"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);}}
function nowIso(){return new Date().toISOString();}
function firstName(n){return String(n||"").trim().split(/\s+/)[0]||"there";}
function byTime(a,b){return a.time.localeCompare(b.time)||a.workshop.localeCompare(b.workshop);}

/* ===== STORAGE ===== */
const SK="reu_reg:";
const storageOK=!!(window.storage&&typeof window.storage.get==="function");
let allRegs=[];

function normalize(r){
  r.email=normEmail(r.email);
  r.name=String(r.name||"").trim();
  r.queuedAt=r.queuedAt||r.ts||nowIso();
  r.forced=!!r.forced;
  const d=slotDef(r.slotId); if(d){r.workshop=d.workshop;r.time=d.time;}
  return r;
}
async function loadRegs(){
  if(!storageOK)return allRegs;
  try{
    const res=await window.storage.list(SK,true);
    const keys=(res&&res.keys)||[];
    const got=await Promise.all(keys.map(async k=>{try{const r=await window.storage.get(k,true);return r&&r.value?JSON.parse(r.value):null;}catch(e){return null;}}));
    return got.filter(r=>r&&r.id&&r.slotId&&r.email).map(normalize);
  }catch(e){console.warn("Load failed",e);return allRegs;}
}
async function saveReg(r){
  if(!storageOK)return true; // in-memory mode (banner warns)
  try{const res=await window.storage.set(SK+r.id,JSON.stringify(r),true);return res!==null;}catch(e){console.warn("Save failed",e);return false;}
}
async function deleteReg(id){
  if(!storageOK)return true;
  try{await window.storage.delete(SK+id,true);return true;}catch(e){console.warn("Delete failed",e);return false;}
}
async function refresh(){allRegs=await loadRegs();rebuildStatus();}

/* ===== STATUS (derived from queue order) =====
   Per session: admin-guaranteed seats first, then everyone else by queuedAt.
   The first `cap` are confirmed, the rest are waitlisted. Removing someone
   therefore promotes the next person on the waitlist automatically. */
let statusMap={};
function sessionRegs(sid){return allRegs.filter(r=>r.slotId===sid);}
function deriveSession(sid){
  const d=slotDef(sid);if(!d)return{};
  const regs=sessionRegs(sid).slice().sort((a,b)=>(b.forced?1:0)-(a.forced?1:0)||String(a.queuedAt).localeCompare(String(b.queuedAt))||a.id.localeCompare(b.id));
  const out={};let conf=0;
  regs.forEach(r=>{if(r.forced||conf<d.cap){out[r.id]="confirmed";conf++;}else out[r.id]="waitlist";});
  return out;
}
function rebuildStatus(){statusMap={};SLOT_DEFS.forEach(d=>Object.assign(statusMap,deriveSession(d.id)));}
function statusOf(r){return statusMap[r.id]||r.status||"confirmed";}
function waitPosition(r){
  if(statusOf(r)!=="waitlist")return 0;
  const q=sessionRegs(r.slotId).filter(x=>statusOf(x)==="waitlist").sort((a,b)=>String(a.queuedAt).localeCompare(String(b.queuedAt))||a.id.localeCompare(b.id));
  return q.findIndex(x=>x.id===r.id)+1;
}
/* Write any changed statuses back; returns people promoted off the waitlist */
async function syncStatuses(sids){
  rebuildStatus();const promos=[];
  for(const r of allRegs){
    if(sids&&!sids.includes(r.slotId))continue;
    const s=statusOf(r);
    if(r.status!==s){
      if(r.status==="waitlist"&&s==="confirmed"){r.promotedAt=nowIso();promos.push(r);}
      r.status=s;await saveReg(r);
    }
  }
  return promos;
}

function confCount(sid){return sessionRegs(sid).filter(r=>statusOf(r)==="confirmed").length;}
function waitCount(sid){return sessionRegs(sid).filter(r=>statusOf(r)==="waitlist").length;}
function confRemain(sid){const d=slotDef(sid);return d?Math.max(0,d.cap-confCount(sid)):0;}
function waitRemain(sid){const d=slotDef(sid);return d?Math.max(0,d.wcap-waitCount(sid)):0;}
function slotState(sid){if(confRemain(sid)>0)return"open";if(waitRemain(sid)>0)return"waitlist";return"full";}
function statusForNew(sid){return confRemain(sid)>0?"confirmed":(waitRemain(sid)>0?"waitlist":"full");}

/* ===== PEOPLE & RULES ===== */
function bookingsFor(email){const e=normEmail(email);return allRegs.filter(r=>r.email===e).sort(byTime);}
function bookedTopics(email){const m={};bookingsFor(email).forEach(r=>{m[r.workshop]=r;});return m;}
function hasBookings(){return !!S.email&&bookingsFor(S.email).length>0;}
/* Same rules everywhere: one session per topic (so only one STX), one session per time slot */
function ruleCheck(email,sid,excludeId){
  const d=slotDef(sid);if(!d)return"that session doesn't exist";
  const mine=bookingsFor(email).filter(r=>r.id!==excludeId);
  if(mine.some(r=>r.slotId===sid))return"already booked for this session";
  const sameTopic=mine.find(r=>r.workshop===d.workshop);
  if(sameTopic)return d.workshop==="STX"?`already booked for the STX session at ${sameTopic.time} (only one of the two is allowed)`:`already booked for ${d.workshop} at ${sameTopic.time}`;
  const sameTime=mine.find(r=>r.time===d.time);
  if(sameTime)return`already booked for ${topicLabel(sameTime.workshop)} at ${d.time}`;
  return null;
}
function peopleCount(){return new Set(allRegs.map(r=>r.email)).size;}

/* ===== STATE ===== */
const S={view:"reg",step:1,name:"",email:"",autoName:false,selTopics:[],selSlots:{},lastNewIds:[],submitError:"",adminSearch:"",adminSort:"date",adminAuth:false};

function updateCount(){const n=peopleCount();document.getElementById("regCount").textContent=n+" participant"+(n===1?"":"s");}

function seatPill(sid){
  const st=slotState(sid);
  if(st==="full")return`<span class="seat-pill full">Full</span>`;
  if(st==="waitlist")return`<span class="seat-pill wait">Waitlist · ${waitRemain(sid)} left</span>`;
  const d=slotDef(sid),rem=confRemain(sid),pct=rem/d.cap;
  const cls=pct>.5?"green":pct>.2?"yellow":"red";
  return`<span class="seat-pill ${cls}">${rem} seat${rem===1?"":"s"} left</span>`;
}
function statusBadge(r){
  const st=statusOf(r);
  if(st==="waitlist"){const p=waitPosition(r);return`<span class="status-badge wait">Waitlist${p?" #"+p:""}</span>`;}
  return`<span class="status-badge conf">Confirmed</span>`;
}
function showToast(msg,ms){
  const old=document.querySelector(".toast");if(old)old.remove();
  const t=document.createElement("div");t.className="toast";t.innerHTML=msg;document.body.appendChild(t);
  setTimeout(()=>t.remove(),ms||5000);
}
function promoText(promos){
  if(!promos.length)return"";
  return" Promoted from waitlist: "+promos.map(p=>`<strong>${esc(p.name)}</strong> (${esc(sessionLabel(p.slotId))})`).join(", ")+". Let them know.";
}

/* ===== TIMETABLE ===== */
function renderTT(){
  const mine=S.email&&S.view==="reg"?bookingsFor(S.email):[];
  let h='<colgroup><col class="c-time">';
  for(let i=1;i<=6;i++)h+='<col>';
  h+='</colgroup><thead><tr><th>Time</th>';
  for(let i=1;i<=6;i++)h+=`<th>Slot ${i}</th>`;
  h+='</tr></thead><tbody>';
  GRID.forEach((row,ri)=>{
    h+=`<tr><td class="time">${TIMES[ri]}</td>`;
    row.forEach(ws=>{
      const booked=mine.some(r=>r.workshop===ws&&r.time===TIMES[ri]);
      const cls=booked?' class="bk"':(S.selTopics.includes(ws)?' class="hl"':"");
      h+=`<td${cls}>${ws}</td>`;
    });
    h+='</tr>';
  });
  h+='</tbody>';
  document.getElementById("ttTable").innerHTML=h;
  const leg=[];
  if(S.selTopics.length)leg.push('<span class="dot"></span>Selected topics');
  if(mine.some(r=>r.workshop!=="STX"))leg.push('<span class="dot bk"></span>Your bookings');
  const L=document.getElementById("ttLegend");L.innerHTML=leg.join('<span style="display:inline-block;width:14px"></span>');L.style.display=leg.length?"block":"none";
}

/* ===== STEPPER & ID BAR ===== */
function stepperH(){
  const st=[["1","Details"],["2","Topics"],["3","Time slots"],["4","Confirm"]];
  return'<div class="stepper">'+st.map(([n,l],i)=>{
    const idx=i+1,cls=idx<S.step?"done":idx===S.step?"active":"",mark=idx<S.step?"✓":n;
    return`<div class="step-tab ${cls}"><span class="num">${mark}</span><span class="lbl">${l}</span></div>`;
  }).join("")+'</div>';
}
function idBarH(){
  if(!S.email||S.step<=1||S.step>=5)return"";
  const n=bookingsFor(S.email).length;
  const manage=(n&&S.step!==1.5)?`<button class="link-btn" data-act="manage">My bookings (${n})</button>`:"";
  return`<div class="id-bar"><span>Registering as <strong>${esc(S.name)}</strong> · ${esc(S.email)}</span><span style="flex:1"></span>${manage}<button class="link-btn" data-act="switch">Not you? Switch email</button></div>`;
}

/* ===== RENDER ===== */
function render(){
  renderTT();updateCount();
  document.body.classList.toggle("is-admin",S.view==="admin");
  const m=document.getElementById("mainCol");
  document.getElementById("adminBtn").style.display=S.view==="admin"?"none":"";
  document.getElementById("backBtn").style.display=S.view==="admin"?"":"none";
  if(S.view==="admin"){m.innerHTML=adminH();wireAdmin();return;}
  if(S.step===1)m.innerHTML=step1H();
  else if(S.step===1.5)m.innerHTML=manageH();
  else if(S.step===2)m.innerHTML=step2H();
  else if(S.step===3)m.innerHTML=step3H();
  else if(S.step===4)m.innerHTML=step4H();
  else m.innerHTML=successH();
  wireStep();
}
function goStep(n){S.step=n;if(n!==3&&n!==4)S.submitError="";render();window.scrollTo({top:0});}

/* ===== STEP 1: details / sign-in by email ===== */
function step1H(){
  return stepperH()+`<div class="panel">
  <h1>Register for REU Experience Day</h1>
  <div class="event-meta">
    <span class="meta-pill"><span class="mp-ico">📅</span>27 October 2026</span>
    <span class="meta-pill"><span class="mp-ico">📍</span>MCW</span>
    <span class="meta-pill"><span class="mp-ico">🕒</span>09:30–20:00</span>
  </div>
  <p class="lede">Pick the sessions you want and choose a time slot for each — it takes under a minute. Already registered? Enter the same email to see and change your bookings.</p>
  <div class="field" id="fE"><label for="inE">Email address</label><input id="inE" type="email" autocomplete="email" placeholder="e.g. max.mustermann@bshg.com" value="${esc(S.email)}"><div class="hint">Please enter a valid email address.</div><div class="found-hint" id="foundHint" style="display:none"></div></div>
  <div class="field" id="fN"><label for="inN">Full name</label><input id="inN" type="text" autocomplete="name" placeholder="e.g. Max Mustermann" value="${esc(S.name)}"><div class="hint">Please enter your full name.</div></div>
  <div class="btn-row"><button class="btn-primary" id="toS2" disabled>Continue</button></div>
  </div>`;
}

/* ===== STEP 1.5: returning participant ===== */
function manageH(){
  const mine=bookingsFor(S.email);
  const booked=bookedTopics(S.email);
  const remaining=ALL_TOPICS.filter(t=>!booked[t]);
  const rows=mine.map(r=>`<div class="b-row"><span class="b-topic">${esc(topicLabel(r.workshop))} ${statusBadge(r)}</span><span class="b-time">${r.time}</span><button class="btn-small danger" data-act="cancel-own" data-id="${esc(r.id)}">Cancel</button></div>`).join("");
  const anyWait=mine.some(r=>statusOf(r)==="waitlist");
  const waitNote=anyWait?`<div class="note-box wait"><span class="note-icon">i</span><div>You're on the <strong>waitlist</strong> for at least one session. The number shows your place in line. If a seat frees up you move up automatically and the organising team will confirm by email.</div></div>`:"";
  const body=mine.length
    ?`<div class="list-label">Your bookings</div><div class="bookings">${rows}</div>`
    :`<div class="empty" style="border:1px dashed var(--line);border-radius:8px;max-width:600px"><div class="icon">▦</div>You have no bookings at the moment.</div>`;
  const allDone=remaining.length===0;
  const doneNote=allDone?`<div class="note-box" style="margin-top:16px"><span class="note-icon">i</span><div>You're booked for every topic, so there's nothing left to add. To switch a time slot, cancel that booking first and then add it again.</div></div>`:"";
  return stepperH()+idBarH()+`<div class="panel">
  <h1>${mine.length?"Welcome back, "+esc(firstName(S.name)):"Your registration"}</h1>
  <p class="lede">${mine.length?"You're already registered for the sessions below. Add more sessions or cancel the ones you no longer need.":"Choose the sessions you'd like to attend."}</p>
  ${waitNote}${body}${doneNote}
  <div class="btn-row"><button class="btn-secondary" data-act="goto" data-step="1">Back</button>
  ${allDone?"":`<button class="btn-primary" data-act="goto" data-step="2">${mine.length?"Add more sessions":"Choose sessions"}</button>`}</div>
  </div>`;
}

/* ===== STEP 2: topics ===== */
function step2H(){
  const booked=bookedTopics(S.email);
  S.selTopics=S.selTopics.filter(t=>!booked[t]);
  Object.keys(S.selSlots).forEach(k=>{if(!S.selTopics.includes(k))delete S.selSlots[k];});
  const bookedTag=r=>`<span class="booked-tag${statusOf(r)==="waitlist"?" wl":""}">✓ Booked · ${r.time}${statusOf(r)==="waitlist"?" (waitlist)":""}</span>`;
  let stxCard;
  if(booked.STX){
    stxCard=`<div style="margin-bottom:8px"><div class="ws-card stx booked"><h3>STX Strategy Update</h3><p>VCP deployment, Brand Portfolio &amp; Consumer Journey Steering, Channel Management.</p>${bookedTag(booked.STX)}</div></div>`;
  }else{
    const sel=S.selTopics.includes("STX");
    stxCard=`<div style="margin-bottom:8px">
    <button class="ws-card stx ${sel?"selected":""}" data-ws="STX" aria-pressed="${sel}">
      <span class="check ${sel?"on":""}">✓</span>
      <h3>STX Strategy Update</h3>
      <p>VCP deployment, Brand Portfolio &amp; Consumer Journey Steering, Channel Management. Two identical sessions available (09:30 &amp; 11:00).</p>
      <span class="meta">50 seats per session</span>
    </button></div>`;
  }
  const cards=WORKSHOPS.map(w=>{
    if(booked[w.key])return`<div class="ws-card booked"><h3>${esc(w.key)}</h3><p>${esc(w.desc)}</p>${bookedTag(booked[w.key])}</div>`;
    const sel=S.selTopics.includes(w.key);
    const avail=TIMES.filter(t=>slotState(slotId(w.key,t))!=="full").length;
    return`<button class="ws-card ${sel?"selected":""}" data-ws="${esc(w.key)}" aria-pressed="${sel}">
      <span class="check">${sel?"✓":""}</span><h3>${esc(w.key)}</h3><p>${esc(w.desc)}</p>
      <span class="meta">${avail} of 6 sessions with seats</span></button>`;
  }).join("");
  const returning=hasBookings();
  return stepperH()+idBarH()+`<div class="panel">
  <h1>${returning?"Add more sessions":"Which sessions interest you?"}</h1>
  <p class="lede">${returning?"Topics you've already booked are marked. Select any additional sessions — the system blocks time clashes with your existing bookings.":"Select one or more. You can attend the STX plenary and multiple product workshops — the system blocks time clashes automatically."}</p>
  ${stxCard}<div class="card-grid">${cards}</div>
  <div class="btn-row"><button class="btn-secondary" data-act="goto" data-step="${returning?1.5:1}">Back</button>
  <button class="btn-primary" id="toS3" ${S.selTopics.length?"":"disabled"}>Continue to time slots${S.selTopics.length?` (${S.selTopics.length})`:""}</button></div></div>`;
}

/* ===== STEP 3: time slots ===== */
function step3H(){
  const mine=bookingsFor(S.email);
  let groups="";
  // Drop a stored choice that is no longer valid
  S.selTopics.forEach(ws=>{
    const sid=S.selSlots[ws];if(!sid)return;
    const d=slotDef(sid);
    const otherSel=Object.entries(S.selSlots).some(([k,id])=>k!==ws&&slotDef(id).time===d.time);
    if(slotState(sid)==="full"||ruleCheck(S.email,sid)||otherSel)delete S.selSlots[ws];
  });
  if(S.selTopics.includes("STX")){
    const chosen=S.selSlots["STX"];
    const btns=STX_SESSIONS.map(s=>{
      const sid=slotId(s.key,s.time);
      const st=slotState(sid),sel=chosen===sid,dis=st==="full"&&!sel;
      const wcls=st==="waitlist"?" waitlist":"";
      return`<button class="slot-btn ${sel?"selected":""}${wcls}" data-slot="${sid}" data-ws="STX" ${dis?"disabled":""}>${s.time} ${seatPill(sid)}</button>`;
    }).join("");
    groups+=`<div class="slot-group"><h3>STX Strategy Update</h3><div class="sub">Choose exactly one of the two identical sessions — you can't attend both.</div><div class="slot-list">${btns}</div></div>`;
  }
  S.selTopics.filter(t=>t!=="STX").forEach(ws=>{
    const chosen=S.selSlots[ws];
    const otherSel=Object.entries(S.selSlots).filter(([k])=>k!==ws).map(([,id])=>slotDef(id).time);
    let usable=0;
    const btns=TIMES.map(t=>{
      const sid=slotId(ws,t);
      const st=slotState(sid);
      const own=mine.find(r=>r.time===t);
      const clash=otherSel.includes(t);
      const dis=st==="full"||clash||!!own;
      if(!dis)usable++;
      const sel=chosen===sid;
      const wcls=(st==="waitlist"&&!dis)?" waitlist":"";
      const tag=own?`<span class="seat-pill full">booked: ${esc(topicLabel(own.workshop))}</span>`:(clash?'<span class="seat-pill full">clash</span>':seatPill(sid));
      return`<button class="slot-btn ${sel?"selected":""}${wcls}" data-slot="${sid}" data-ws="${esc(ws)}" ${dis?"disabled":""}>${t} ${tag}</button>`;
    }).join("");
    const stuck=usable===0?`<div class="sub" style="color:var(--red)">No time slot fits your schedule for this topic. <button class="link-btn" data-act="drop-topic" data-ws="${esc(ws)}">Remove ${esc(ws)} from this registration</button></div>`:`<div class="sub">Pick exactly one session.</div>`;
    groups+=`<div class="slot-group"><h3>${esc(ws)}</h3>${stuck}<div class="slot-list">${btns}</div></div>`;
  });
  const allChosen=S.selTopics.length>0&&S.selTopics.every(ws=>S.selSlots[ws]);
  const stxBooked=!!bookedTopics(S.email).STX;
  const stxNote=(S.selTopics.includes("STX")||stxBooked)?"":`<div class="note-box"><span class="note-icon">i</span><div><strong>Looking for the STX Strategy Update?</strong> It isn't in your list. To attend, go back one step and select the STX Strategy Update card, then pick one of its two sessions here.</div></div>`;
  const err=S.submitError?`<div class="error-box"><span>⚠</span><div>${S.submitError}</div></div>`:"";
  return stepperH()+idBarH()+`<div class="panel">
  <h1>Choose your time slots</h1>
  <p class="lede">Only your selected topics are shown. Times you're already booked for are blocked to prevent clashes.</p>
  ${err}${stxNote}${groups}
  <div class="btn-row"><button class="btn-secondary" data-act="goto" data-step="2">Back</button>
  <button class="btn-primary" id="toS4" ${allChosen?"":"disabled"}>Review registration</button></div></div>`;
}

/* ===== STEP 4: confirm ===== */
function step4H(){
  let anyWait=false;
  const existing=bookingsFor(S.email).map(r=>`<div class="item existing"><span>${esc(topicLabel(r.workshop))} <span class="status-badge ${statusOf(r)==="waitlist"?"wait":"conf"}" style="opacity:.75">Already booked</span></span><span>${r.time}</span></div>`).join("");
  const items=S.selTopics.map(ws=>{
    const sid=S.selSlots[ws],d=slotDef(sid);
    const wl=statusForNew(sid)==="waitlist";if(wl)anyWait=true;
    return`<div class="item"><span>${esc(topicLabel(ws))}${wl?' <span class="status-badge wait">Waitlist</span>':""}</span><span>${d.time}</span></div>`;
  }).sort().join("");
  const waitNote=anyWait?`<div class="note-box wait"><span class="note-icon">i</span><div>One or more of your sessions is full, so you'll join its <strong>waitlist</strong>. You'll keep your spot in line and move up automatically if a seat frees up — the organising team will confirm by email.</div></div>`:"";
  const err=S.submitError?`<div class="error-box"><span>⚠</span><div>${S.submitError}</div></div>`:"";
  return stepperH()+idBarH()+`<div class="panel">
  <h1>Confirm your registration</h1>
  <p class="lede">Please review. Seats are reserved only after you confirm.</p>
  ${err}${waitNote}
  <div class="summary-box">
    <div class="row"><span class="k">Name</span><span class="v">${esc(S.name)}</span></div>
    <div class="row"><span class="k">Email</span><span class="v">${esc(S.email)}</span></div>
    <div class="summary-ws"><div class="k">${existing?"Adding now":"Selected sessions"}</div>${items}${existing?`<div class="k" style="margin-top:8px">Already booked</div>${existing}`:""}</div>
  </div>
  <div class="btn-row"><button class="btn-secondary" data-act="goto" data-step="3">Back</button>
  <button class="btn-primary" id="confirmBtn">Confirm registration</button></div></div>`;
}

/* ===== SUCCESS ===== */
function successH(){
  const mine=bookingsFor(S.email);
  const anyNewWait=mine.some(r=>S.lastNewIds.includes(r.id)&&statusOf(r)==="waitlist");
  const items=mine.map(r=>{
    const isNew=S.lastNewIds.includes(r.id);
    return`<div class="item"><span>${esc(topicLabel(r.workshop))} ${statusBadge(r)}${isNew?' <span class="status-badge promo">New</span>':""}</span><span>${r.time}</span></div>`;
  }).join("");
  const waitLine=anyNewWait?`<p style="color:#8A6D00">A session was full, so you're on its waitlist. You'll move up automatically if a seat frees up, and the organising team will email you.</p>`:"";
  return`<div class="success"><div class="tick">✓</div>
  <h1>You're registered, ${esc(firstName(S.name))}</h1>
  <p>See you on 27 October. Don't forget the Apéro &amp; Pizza gathering from 17:30!</p>
  ${waitLine}
  <div class="list-label" style="text-align:left;margin-top:14px">All your bookings</div>
  <div class="booked" style="margin-top:0">${items}</div>
  <div class="btn-row" style="justify-content:center">
    <button class="btn-secondary" data-act="goto" data-step="1.5">Manage my bookings</button>
    <button class="btn-primary" data-act="reset">Register another participant</button>
  </div></div>`;
}

/* ===== WIRING (inputs + step buttons) ===== */
function wireStep(){
  if(S.step===1){
    const n=document.getElementById("inN"),e=document.getElementById("inE"),btn=document.getElementById("toS2"),hint=document.getElementById("foundHint");
    const sync=()=>{
      const em=normEmail(e.value);
      const found=validEmail(em)?bookingsFor(em):[];
      if(found.length){
        hint.style.display="block";
        hint.textContent=`Welcome back — we found ${found.length} booking${found.length===1?"":"s"} for this email.`;
        if(!n.value.trim()||S.autoName){n.value=found[found.length-1].name;S.autoName=true;}
      }else{
        hint.style.display="none";
        if(S.autoName){n.value="";S.autoName=false;}
      }
      const ok=n.value.trim().length>=2&&validEmail(em);
      btn.disabled=!ok;
      document.getElementById("fN").classList.toggle("invalid",n.value.length>0&&n.value.trim().length<2);
      document.getElementById("fE").classList.toggle("invalid",e.value.length>0&&!validEmail(em));
    };
    n.addEventListener("input",()=>{S.autoName=false;sync();});
    e.addEventListener("input",sync);sync();
    btn.addEventListener("click",async()=>{
      btn.disabled=true;btn.textContent="Checking…";
      const em=normEmail(e.value);
      if(S.email&&S.email!==em){S.selTopics=[];S.selSlots={};}
      S.email=em;S.name=n.value.trim();
      await refresh();
      goStep(hasBookings()?1.5:2);
    });
    (S.email?n:e).focus();
  }
  if(S.step===2){
    document.querySelectorAll("button.ws-card").forEach(c=>c.addEventListener("click",()=>{
      const ws=c.dataset.ws,i=S.selTopics.indexOf(ws);
      if(i>=0){S.selTopics.splice(i,1);delete S.selSlots[ws];}else S.selTopics.push(ws);
      render();
    }));
    document.getElementById("toS3")?.addEventListener("click",()=>goStep(3));
  }
  if(S.step===3){
    document.querySelectorAll(".slot-btn:not(:disabled)").forEach(b=>b.addEventListener("click",()=>{S.selSlots[b.dataset.ws]=b.dataset.slot;render();}));
    document.getElementById("toS4")?.addEventListener("click",()=>{S.submitError="";goStep(4);});
  }
  if(S.step===4){document.getElementById("confirmBtn").addEventListener("click",submitReg);}
}

/* ===== SUBMIT ===== */
async function submitReg(){
  const btn=document.getElementById("confirmBtn");btn.disabled=true;btn.textContent="Saving…";
  S.submitError="";
  await refresh(); // re-check against the latest data from everyone
  const problems=[];
  for(const ws of S.selTopics.slice()){
    const sid=S.selSlots[ws],d=slotDef(sid);
    const rule=ruleCheck(S.email,sid);
    if(rule){
      problems.push(`${esc(topicLabel(ws))} at ${d.time}: you're ${esc(rule)}.`);
      if(bookedTopics(S.email)[ws])S.selTopics=S.selTopics.filter(t=>t!==ws);
      delete S.selSlots[ws];
    }else if(slotState(sid)==="full"){
      problems.push(`${esc(topicLabel(ws))} at ${d.time} filled up completely (including the waitlist) while you were registering. Please pick another time.`);
      delete S.selSlots[ws];
    }
  }
  if(problems.length){
    S.submitError="Some of your choices changed while you were registering. Nothing has been saved yet.<br>"+problems.join("<br>");
    if(!S.selTopics.length){goStep(hasBookings()?1.5:2);return;}
    S.step=3;render();window.scrollTo({top:0});return;
  }
  const now=nowIso();
  const newRegs=S.selTopics.map(ws=>{const sid=S.selSlots[ws],d=slotDef(sid);return{id:uid(),name:S.name,email:S.email,workshop:ws,slotId:sid,time:d.time,ts:now,queuedAt:now,forced:false,source:"self"};});
  allRegs.push(...newRegs);rebuildStatus();
  const saved=[];let failed=false;
  for(const r of newRegs){r.status=statusOf(r);if(await saveReg(r))saved.push(r);else{failed=true;break;}}
  if(failed){
    for(const r of saved)await deleteReg(r.id);
    allRegs=allRegs.filter(x=>!newRegs.includes(x));rebuildStatus();
    S.submitError="We couldn't save your registration, so nothing was booked. Please try again in a moment. If it keeps failing, contact the organising team.";
    render();return;
  }
  S.lastNewIds=newRegs.map(r=>r.id);
  S.selTopics=[];S.selSlots={};
  S.step=5;render();window.scrollTo({top:0});
}

function resetFlow(){Object.assign(S,{step:1,name:"",email:"",autoName:false,selTopics:[],selSlots:{},lastNewIds:[],submitError:"",view:"reg"});render();window.scrollTo({top:0});}

/* ===== MODALS ===== */
function openModal(html,wide){document.getElementById("modalRoot").innerHTML=`<div class="modal-bg" data-act="modal-bg"><div class="modal${wide?" wide":""}">${html}</div></div>`;}
function closeModal(){document.getElementById("modalRoot").innerHTML="";}
function modalErr(msg){const e=document.getElementById("mErr");if(e)e.textContent=msg;}

/* Participant cancels one of their own bookings */
function askCancelOwn(id){
  const r=allRegs.find(x=>x.id===id);if(!r)return;
  openModal(`<h2>Cancel this booking?</h2><p>${esc(topicLabel(r.workshop))} at ${r.time}. Your seat will go to the next person on the waitlist.</p><div class="err" id="mErr"></div>
  <div class="btn-row"><button class="btn-secondary" data-act="close-modal">Keep it</button><button class="btn-danger" data-act="confirm-cancel-own" data-id="${esc(id)}">Cancel booking</button></div>`);
}
async function doCancelOwn(id){
  const r=allRegs.find(x=>x.id===id);if(!r||r.email!==S.email){closeModal();return;}
  if(!await deleteReg(id)){modalErr("Couldn't cancel right now. Please try again.");return;}
  closeModal();
  await refresh();allRegs=allRegs.filter(x=>x.id!==id);
  await syncStatuses([r.slotId]);
  showToast(`Your ${esc(topicLabel(r.workshop))} booking at ${r.time} was cancelled.`);
  render();
}

/* Admin PIN */
function openAdmin(){
  if(S.adminAuth){enterAdmin();return;}
  openModal(`<h2>Admin access</h2><p>Enter the admin PIN to continue.</p>
    <input type="password" id="pinIn" maxlength="10" inputmode="numeric">
    <div class="err" id="pinErr"></div>
    <div class="btn-row" style="justify-content:center"><button class="btn-secondary" data-act="close-modal">Cancel</button><button class="btn-primary" id="pinGo">Unlock</button></div>`);
  const inp=document.getElementById("pinIn");inp.focus();
  const go=()=>{if(inp.value===ADMIN_PIN){S.adminAuth=true;closeModal();enterAdmin();}else{document.getElementById("pinErr").textContent="Incorrect PIN. Try again.";inp.value="";inp.focus();}};
  document.getElementById("pinGo").addEventListener("click",go);
  inp.addEventListener("keydown",e=>{if(e.key==="Enter")go();});
}
async function enterAdmin(){S.view="admin";render();await refresh();render();}
function closeAdmin(){S.view="reg";render();}

/* Session <select> options with live availability */
function sessionOptions(selected){
  const groups=ALL_TOPICS.map(t=>{
    const opts=SLOT_DEFS.filter(d=>d.workshop===t).map(d=>{
      const st=slotState(d.id);
      const txt=st==="open"?`${confRemain(d.id)} seats left`:st==="waitlist"?`waitlist, ${waitRemain(d.id)} left`:"full";
      return`<option value="${d.id}" ${d.id===selected?"selected":""}>${d.time} — ${txt}</option>`;
    }).join("");
    return`<optgroup label="${esc(topicLabel(t))}">${opts}</optgroup>`;
  }).join("");
  return groups;
}

/* Admin: add a person */
function openAddModal(){
  openModal(`<h2>Add person</h2><p style="text-align:left">Book someone into a session. The same clash rules apply as for self-registration.</p>
  <div class="mfield"><label for="mName">Full name</label><input id="mName" type="text"></div>
  <div class="mfield"><label for="mEmail">Email</label><input id="mEmail" type="email"></div>
  <div class="mfield"><label for="mSess">Session</label><select id="mSess">${sessionOptions("")}</select></div>
  <label class="mcheck"><input type="checkbox" id="mForce"> Guarantee a confirmed seat, even if this takes the session over capacity</label>
  <div class="err" id="mErr" style="text-align:left"></div>
  <div class="btn-row"><button class="btn-secondary" data-act="close-modal">Cancel</button><button class="btn-primary" data-act="confirm-add">Add person</button></div>`,true);
  const mEmail=document.getElementById("mEmail"),mName=document.getElementById("mName");
  mEmail.addEventListener("input",()=>{const f=bookingsFor(mEmail.value);if(f.length&&!mName.value.trim())mName.value=f[0].name;});
  mName.focus();
}
async function doAdd(){
  const name=document.getElementById("mName").value.trim();
  const email=normEmail(document.getElementById("mEmail").value);
  const sid=document.getElementById("mSess").value;
  const force=document.getElementById("mForce").checked;
  if(name.length<2)return modalErr("Please enter the person's full name.");
  if(!validEmail(email))return modalErr("Please enter a valid email address.");
  await refresh();
  const rule=ruleCheck(email,sid);
  if(rule)return modalErr(`This person is ${rule}.`);
  if(!force&&slotState(sid)==="full")return modalErr("This session is full, including the waitlist. Tick the box above to add them anyway.");
  const d=slotDef(sid),now=nowIso();
  const r={id:uid(),name,email,workshop:d.workshop,slotId:sid,time:d.time,ts:now,queuedAt:now,forced:force,source:"admin"};
  allRegs.push(r);rebuildStatus();r.status=statusOf(r);
  if(!await saveReg(r)){allRegs=allRegs.filter(x=>x!==r);rebuildStatus();return modalErr("Couldn't save. Please try again.");}
  await syncStatuses([sid]);
  closeModal();
  showToast(`Added <strong>${esc(name)}</strong> to ${esc(sessionLabel(sid))} (${statusOf(r)==="waitlist"?"waitlist":"confirmed"}).`);
  render();
}

/* Admin: move a person to another session */
function openMoveModal(id){
  const r=allRegs.find(x=>x.id===id);if(!r)return;
  openModal(`<h2>Move person</h2>
  <div class="current"><strong>${esc(r.name)}</strong> · ${esc(r.email)}<br>Currently: ${esc(sessionLabel(r.slotId))} (${statusOf(r)})</div>
  <div class="mfield"><label for="mSess">Move to</label><select id="mSess">${sessionOptions(r.slotId)}</select></div>
  <label class="mcheck"><input type="checkbox" id="mForce" ${r.forced?"checked":""}> Guarantee a confirmed seat, even if this takes the session over capacity</label>
  <p style="text-align:left;font-size:.78rem;margin:0 0 4px">Moving to a different session puts them at the back of that session's queue unless the box is ticked.</p>
  <div class="err" id="mErr" style="text-align:left"></div>
  <div class="btn-row"><button class="btn-secondary" data-act="close-modal">Cancel</button><button class="btn-primary" data-act="confirm-move" data-id="${esc(id)}">Move</button></div>`,true);
}
async function doMove(id){
  const sid=document.getElementById("mSess").value;
  const force=document.getElementById("mForce").checked;
  await refresh();
  const r=allRegs.find(x=>x.id===id);
  if(!r){closeModal();showToast("That booking no longer exists — it may have been cancelled.");render();return;}
  const old=r.slotId;
  if(sid===old&&force===r.forced){closeModal();return;}
  if(sid!==old){
    const rule=ruleCheck(r.email,sid,r.id);
    if(rule)return modalErr(`Can't move: this person is ${rule}.`);
    if(!force&&slotState(sid)==="full")return modalErr("That session is full, including the waitlist. Tick the box above to move them anyway.");
  }
  const backup={...r};const d=slotDef(sid);
  Object.assign(r,{slotId:sid,workshop:d.workshop,time:d.time,forced:force,movedAt:nowIso()});
  if(sid!==old)r.queuedAt=nowIso();
  rebuildStatus();r.status=statusOf(r);
  if(!await saveReg(r)){Object.assign(r,backup);rebuildStatus();return modalErr("Couldn't save. Please try again.");}
  const promos=(await syncStatuses([old,sid])).filter(p=>p.id!==r.id);
  closeModal();
  showToast(`Moved <strong>${esc(r.name)}</strong> to ${esc(sessionLabel(sid))} (${statusOf(r)}).`+promoText(promos),8000);
  render();
}

/* Admin: remove a person from a session */
function openRemoveModal(id){
  const r=allRegs.find(x=>x.id===id);if(!r)return;
  openModal(`<h2>Remove booking?</h2><p>${esc(r.name)} will be removed from ${esc(sessionLabel(r.slotId))}. If the session has a waitlist, the next person moves up automatically.</p>
  <div class="err" id="mErr"></div>
  <div class="btn-row" style="justify-content:center"><button class="btn-secondary" data-act="close-modal">Cancel</button><button class="btn-danger" data-act="confirm-remove" data-id="${esc(id)}">Remove</button></div>`);
}
async function doRemove(id){
  const r=allRegs.find(x=>x.id===id);if(!r){closeModal();return;}
  if(!await deleteReg(id))return modalErr("Couldn't remove right now. Please try again.");
  closeModal();
  await refresh();allRegs=allRegs.filter(x=>x.id!==id);
  const promos=await syncStatuses([r.slotId]);
  showToast(`Removed <strong>${esc(r.name)}</strong> from ${esc(sessionLabel(r.slotId))}.`+promoText(promos),8000);
  render();
}

/* ===== ADMIN VIEW ===== */
function adminH(){
  const q=S.adminSearch.toLowerCase();
  let rows=allRegs.filter(r=>!q||r.name.toLowerCase().includes(q)||r.email.includes(q)||topicLabel(r.workshop).toLowerCase().includes(q)||r.time.includes(q));
  const sorters={
    date:(a,b)=>String(b.ts).localeCompare(String(a.ts)),
    workshop:(a,b)=>a.workshop.localeCompare(b.workshop)||a.time.localeCompare(b.time),
    time:(a,b)=>a.time.localeCompare(b.time)||a.workshop.localeCompare(b.workshop),
    name:(a,b)=>a.name.localeCompare(b.name)||a.time.localeCompare(b.time),
    status:(a,b)=>statusOf(a).localeCompare(statusOf(b))||a.workshop.localeCompare(b.workshop),
  };
  rows=[...rows].sort(sorters[S.adminSort]||sorters.date);
  const tableRows=rows.map(r=>{
    const extra=(r.promotedAt&&statusOf(r)==="confirmed"?`<span class="status-badge promo" title="Promoted ${esc(new Date(r.promotedAt).toLocaleString("en-GB"))}">Promoted</span>`:"")+(r.forced?'<span class="status-badge forced" title="Seat guaranteed by admin">Override</span>':"");
    return`<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(topicLabel(r.workshop))}</td><td>${r.time}</td><td>${statusBadge(r)}${extra}</td><td>${esc(new Date(r.ts).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}))}${r.source==="admin"?' <span style="color:var(--ink-3)">(admin)</span>':""}</td>
    <td><div class="row-actions"><button class="btn-small" data-act="admin-move" data-id="${esc(r.id)}">Move</button><button class="btn-small danger" data-act="admin-remove" data-id="${esc(r.id)}">Remove</button></div></td></tr>`;
  }).join("");
  const arrow=k=>S.adminSort===k?"▾":"";
  const regTbl=rows.length?`<table class="data"><thead><tr>
    <th class="sortable" data-sort="name">Name ${arrow("name")}</th><th>Email</th>
    <th class="sortable" data-sort="workshop">Session ${arrow("workshop")}</th>
    <th class="sortable" data-sort="time">Time ${arrow("time")}</th>
    <th class="sortable" data-sort="status">Status ${arrow("status")}</th>
    <th class="sortable" data-sort="date">Registered ${arrow("date")}</th><th>Actions</th>
    </tr></thead><tbody>${tableRows}</tbody></table>`
    :`<div class="empty"><div class="icon">▦</div>${allRegs.length?"No registrations match your search.":"No registrations yet. Use “Add person” to book someone manually."}</div>`;

  const capRows=SLOT_DEFS.map(d=>{
    const conf=confCount(d.id),wait=waitCount(d.id),st=slotState(d.id);
    const confPct=Math.min(100,Math.round(conf/d.cap*100));
    const col=st==="full"?"var(--red)":st==="waitlist"?"#E0A800":(confRemain(d.id)>=Math.ceil(d.cap*.5)?"var(--green)":"var(--yellow)");
    const lbl=d.workshop==="STX"?(d.label||"STX"):d.workshop;
    return`<tr><td>${esc(lbl)} · ${d.time}</td><td>${conf} / ${d.cap}</td><td>${wait>0?`<strong style="color:#8A6D00">${wait}</strong>`:"0"} / ${d.wcap}</td><td>${seatPill(d.id)}</td><td><div class="cap-bar"><i style="width:${confPct}%;background:${col}"></i></div></td></tr>`;
  }).join("");

  const n=peopleCount();
  return`<div class="admin panel">
  <h1>Admin dashboard</h1>
  <p class="lede">${n} participant${n===1?"":"s"} · ${allRegs.length} booking${allRegs.length===1?"":"s"} across ${SLOT_DEFS.length} sessions.</p>
  <div class="section-h">Registrations</div>
  <div class="admin-tools">
    <input type="search" id="aSearch" placeholder="Search name, email, session or time…" value="${esc(S.adminSearch)}">
    <select id="aSort"><option value="date" ${S.adminSort==="date"?"selected":""}>Newest first</option><option value="workshop" ${S.adminSort==="workshop"?"selected":""}>By session</option><option value="time" ${S.adminSort==="time"?"selected":""}>By time</option><option value="status" ${S.adminSort==="status"?"selected":""}>By status</option><option value="name" ${S.adminSort==="name"?"selected":""}>By name</option></select>
    <button class="btn-primary" style="padding:7px 14px;font-size:.83rem" data-act="admin-add">+ Add person</button>
    <button class="btn-secondary" style="padding:7px 14px;font-size:.83rem" data-act="refresh">Refresh</button>
  </div>
  <div class="admin-tools">
    <button class="btn-secondary" style="padding:7px 14px;font-size:.83rem" data-act="export-people" ${allRegs.length?"":"disabled"}>Export CSV (one row per person)</button>
    <button class="btn-secondary" style="padding:7px 14px;font-size:.83rem" data-act="export-detail" ${allRegs.length?"":"disabled"}>Detailed CSV</button>
    <button class="btn-secondary" style="padding:7px 14px;font-size:.83rem" data-act="backup">Backup JSON</button>
    <button class="btn-secondary" style="padding:7px 14px;font-size:.83rem" data-act="import">Import JSON</button>
    <input type="file" id="jsonUp" accept=".json" style="display:none">
  </div>
  <div class="tbl-wrap">${regTbl}</div>
  <div class="section-h">Capacity overview</div>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Session</th><th>Confirmed</th><th>Waitlist</th><th>Status</th><th>Confirmed fill</th></tr></thead><tbody>${capRows}</tbody></table></div>
  </div>`;
}
function wireAdmin(){
  const s=document.getElementById("aSearch");
  s?.addEventListener("input",()=>{S.adminSearch=s.value;refreshAdmin();});
  document.getElementById("aSort")?.addEventListener("change",e=>{S.adminSort=e.target.value;refreshAdmin();});
  document.querySelectorAll("th.sortable").forEach(th=>th.addEventListener("click",()=>{S.adminSort=th.dataset.sort;refreshAdmin();}));
  document.getElementById("jsonUp")?.addEventListener("change",importJson);
}
function refreshAdmin(){const p=document.getElementById("aSearch")?.selectionStart;document.getElementById("mainCol").innerHTML=adminH();wireAdmin();const s=document.getElementById("aSearch");if(s&&S.adminSearch){s.focus();s.setSelectionRange(p,p);}}

/* ===== EXPORTS ===== */
function csvCell(v){let s=String(v==null?"":v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return`"${s.replace(/"/g,'""')}"`;}
function csvDownload(rows,name){dl(new Blob(["﻿"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),name);}
function stamp(){return new Date().toISOString().slice(0,10);}
function exportPeopleCsv(){
  const people={};
  allRegs.forEach(r=>{
    const p=people[r.email]||(people[r.email]={name:r.name,email:r.email,regs:[],latest:""});
    p.regs.push(r);if(String(r.ts)>p.latest){p.latest=String(r.ts);p.name=r.name;}
  });
  const fmt=r=>`${topicLabel(r.workshop)} (${r.time})`;
  const rows=[["Name","Email","Sessions booked (confirmed)","Waitlisted sessions","Number of sessions"]];
  Object.values(people).sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const regs=p.regs.sort(byTime);
    rows.push([p.name,p.email,regs.filter(r=>statusOf(r)==="confirmed").map(fmt).join("; "),regs.filter(r=>statusOf(r)==="waitlist").map(fmt).join("; "),regs.length]);
  });
  csvDownload(rows,`reu-participants-${stamp()}.csv`);
}
function exportDetailCsv(){
  const rows=[["Name","Email","Session","Time","Status","Waitlist position","Registered at","Added by","Promoted at","Seat guaranteed by admin"]];
  allRegs.slice().sort((a,b)=>a.name.localeCompare(b.name)||byTime(a,b)).forEach(r=>rows.push([r.name,r.email,topicLabel(r.workshop),r.time,statusOf(r),waitPosition(r)||"",r.ts,r.source==="admin"?"admin":"self",r.promotedAt||"",r.forced?"yes":""]));
  csvDownload(rows,`reu-bookings-detailed-${stamp()}.csv`);
}
function exportJson(){dl(new Blob([JSON.stringify(allRegs,null,2)],{type:"application/json"}),`reu-registrations-backup-${stamp()}.json`);}
function importJson(e){
  const f=e.target.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=async function(){
    try{
      const data=JSON.parse(reader.result);
      if(!Array.isArray(data)){alert("Invalid file format.");return;}
      await refresh();
      let added=0;const touched=new Set();
      for(const raw of data){
        if(!raw||!raw.id||!raw.name||!raw.email||!raw.slotId||!slotDef(raw.slotId))continue;
        if(allRegs.find(x=>x.id===raw.id))continue;
        const r=normalize({...raw});
        allRegs.push(r);r.status=r.status||"confirmed";
        if(await saveReg(r)){added++;touched.add(r.slotId);}else allRegs=allRegs.filter(x=>x!==r);
      }
      await syncStatuses([...touched]);
      alert(`Imported ${added} booking(s). ${data.length-added} skipped (already present or invalid).`);
      render();
    }catch(err){alert("Could not read that JSON file.");}
  };
  reader.readAsText(f);e.target.value="";
}
function dl(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

/* ===== ONE DELEGATED CLICK HANDLER ===== */
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-act]");if(!b)return;
  const act=b.dataset.act,id=b.dataset.id;
  if(act==="modal-bg"){if(e.target===b)closeModal();return;}
  if(b.tagName==="BUTTON"&&b.disabled)return;
  switch(act){
    case"goto":goStep(parseFloat(b.dataset.step));break;
    case"manage":goStep(1.5);break;
    case"switch":case"reset":resetFlow();break;
    case"drop-topic":S.selTopics=S.selTopics.filter(t=>t!==b.dataset.ws);delete S.selSlots[b.dataset.ws];if(!S.selTopics.length)goStep(2);else render();break;
    case"cancel-own":askCancelOwn(id);break;
    case"confirm-cancel-own":b.disabled=true;await doCancelOwn(id);break;
    case"close-modal":closeModal();break;
    case"admin-add":openAddModal();break;
    case"confirm-add":b.disabled=true;await doAdd();b.disabled=false;break;
    case"admin-move":openMoveModal(id);break;
    case"confirm-move":b.disabled=true;await doMove(id);b.disabled=false;break;
    case"admin-remove":openRemoveModal(id);break;
    case"confirm-remove":b.disabled=true;await doRemove(id);b.disabled=false;break;
    case"refresh":b.disabled=true;b.textContent="Refreshing…";await refresh();render();showToast("Data refreshed.",2000);break;
    case"export-people":exportPeopleCsv();break;
    case"export-detail":exportDetailCsv();break;
    case"backup":exportJson();break;
    case"import":document.getElementById("jsonUp")?.click();break;
  }
});

/* ===== INIT ===== */
(async function(){
  if(!storageOK)document.body.insertAdjacentHTML("afterbegin",'<div class="storage-banner"><strong>Storage isn’t available here.</strong> Registrations are kept only in this browser tab and will be lost when it closes. Open the published claude.ai link to register.</div>');
  render();
  await refresh();render();
})();
</script>
</body>
</html>
```

*End of PRD.*
