# REU Experience Day — Registration

Event registration for REU Experience Day (27 October 2026, MCW): the STX plenary plus six rotating product workshops. Seats are limited (15 per workshop, 50 per plenary session), and each session has a waitlist of 10.

- **Stack:** Next.js 16 (App Router) + Tailwind, hosted on Vercel, with a Supabase (Postgres) database in the EU/Frankfurt region.
- **Spec:** [`docs/REU-Experience-Day-PRD.md`](docs/REU-Experience-Day-PRD.md). The UI, copy and BSH palette are ported from the prototype in its Appendix A.

## How it works

| Concern | Where |
|---|---|
| Seat allocation, waitlist, promotion, clash rules | Postgres functions in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) |
| Participant wizard (Details → Topics → Time slots → Confirm, Manage) | [`components/RegistrationApp.tsx`](components/RegistrationApp.tsx) |
| Admin dashboard (table, add/move/remove, capacity, exports, settings, audit log) | [`components/AdminApp.tsx`](components/AdminApp.tsx) |
| API routes (the browser never talks to the tables) | `app/api/*` |
| Event configuration (timetable, topics, capacities, branding) | stored in the DB and seeded from [`config/event.default.json`](config/event.default.json) |

Key guarantees:

- **No overbooking under concurrency.** `book_sessions` locks the affected session rows (`SELECT … FOR UPDATE`, always in id order) and serialises work per email with an advisory lock. It then re-checks every rule and the capacity, and assigns *confirmed* or *waitlist* at commit time. A trigger re-checks capacity on every insert and move, and unique constraints on `(email, topic)` and `(email, time_slot)` make double-booking, clashes and "both STX sessions" impossible, whatever request is sent.
- **All-or-nothing bookings.** If any selected session was filled or became invalid while the person was choosing, nothing is saved. The person goes back to Step 3 with an explanation for each affected session.
- **Status comes from queue order.** Admin-guaranteed seats are always confirmed, followed by everyone else in `queued_at` order. The first *N* are confirmed and the rest are waitlisted. Cancelling or removing a booking promotes the next person automatically, stamps `promoted_at` and shows a "Promoted" badge. Guaranteed seats come **on top of** capacity, so guaranteeing one person never bumps anyone else to the waitlist.
- **Privacy (no email verification in v1).** Row-level security denies all direct table access. The public API exposes only seat counts and the bookings of the email that was typed in. Names and emails of other people are visible only in the admin dashboard.
- **Live counts.** Seat counts refresh through Supabase Realtime (on a counter table that contains no personal data), with a 12-second polling fallback. Numbers update in place without resetting a person's selections. If a slot they selected fills up, it is marked "Just filled up".
- **Audit trail.** `audit_log` is append-only (enforced by a trigger). It records every create, cancel, remove, move, promote and configuration change.
- **Admin authentication.** The password is checked on the server against `ADMIN_PASSWORD`. A successful login sets a signed HTTP-only cookie for 12 hours, and login attempts are rate-limited. All admin operations use the Supabase service key, which never reaches the browser.

## Run locally (no setup needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. The admin password is `2026` locally.

When no Supabase credentials are set, the app runs the **same SQL migration** in an embedded Postgres (PGlite) stored in `.data/pglite`. To start again with an empty database, delete that folder.

```bash
npm test          # database tests: capacity, waitlist, promotion, rules, all-or-nothing, audit, import, config
npm run typecheck
npm run lint
```

## Deploy (Vercel + Supabase)

1. **Create the database.** Create a Supabase project in the **EU (Frankfurt)** region, either at supabase.com or through Vercel → Marketplace → Supabase.
2. **Create the schema.** Open Supabase → SQL Editor, paste the whole of `supabase/migrations/0001_init.sql` and run it. The script is safe to re-run. It also adds the `availability_version` table to the `supabase_realtime` publication, so live updates work.
3. **Deploy to Vercel.** Push this folder to a Git repository and import it in Vercel (the framework is detected automatically).
4. **Set the environment variables** in Vercel → Settings → Environment Variables. See `.env.example`:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL (Supabase → Project Settings → API) |
   | `SUPABASE_ANON_KEY` | anon / public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**server only**) |
   | `NEXT_PUBLIC_SUPABASE_URL` | same as `SUPABASE_URL` (for Realtime in the browser) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as `SUPABASE_ANON_KEY` |
   | `ADMIN_PASSWORD` | the organisers' admin password |
   | `ADMIN_SESSION_SECRET` | a long random string (`openssl rand -base64 32`) |

5. **Redeploy.** On the first page load, the default event configuration is written to the database.
6. **Logos.** The REU logo is `public/brand/reu-wave.png`. `public/brand/bsh.svg` is still a simple placeholder: replace it with the official BSH wordmark. If a file name or type changes, update the path in Admin → Event settings → Advanced (`branding.primaryLogo` / `branding.secondaryLogo`).
7. **Run the load test** against the deployment, then delete the test rows:
   ```bash
   node scripts/load-test.mjs https://<your-app>.vercel.app 200 ovens_17001730
   ```
   ```sql
   delete from registrations where email like '%@loadtest.example';
   ```

### Before launch

- Confirm with BSH IT and the works council that an externally hosted tool may store employee names and emails. The privacy notice under the registration form can be edited in Settings → Advanced (`registration.privacyNotice`). Agree on a deletion date after the event.
- Optionally restrict registration to corporate addresses: Admin → Event settings → *Allowed email domains* (for example `bshg.com`). The database enforces this as well.
- Supabase Pro includes daily backups. On the free tier, download **Backup JSON** from the admin dashboard regularly. **Import JSON** restores a backup (idempotent by id).

## Reusing it for another event

Everything event-specific can be changed in **Admin → Event settings** without touching code:

- Event name, tagline, date, venue, day start and end, timezone, and allowed email domains.
- Default capacities, plus a confirmed and waitlist capacity for every individual session.
- **Advanced (JSON):** plenary sessions, workshop topics and descriptions, time rows, the rotation grid, the evening gathering, logos and brand colours.

Session ids are derived from topic + time (for example `cooling_13001330`). Renaming a topic or changing a time therefore creates a new session. A session that disappears from the config is deleted only if it has no bookings; otherwise it is hidden and its bookings are kept.

## Not in v1

- **Confirmation and promotion emails** (PRD 8.12). Organisers use **Export CSV (one row per person)**, and the admin toast plus the "Promoted" badges show whom to notify. To add emails later, send them from the API routes after `book_sessions`, `cancel_booking` and `admin_remove`/`admin_move`, which already return the promoted people.
- **Email verification** (PRD 8.19, an accepted risk).
