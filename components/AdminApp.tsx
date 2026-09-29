"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSessions, eveningTopic, topicLabel, validateConfig, type EventConfig } from "@/lib/config";
import { api, useAvailability, useToast, type RealtimeInfo } from "@/lib/client";
import type { AdminBooking, Availability, AuditEntry, Promoted, SessionAvail } from "@/lib/types";
import { AdminLoginModal, Header, Modal, SeatPill, StatusBadge, Toast } from "./ui";

type Tab = "dashboard" | "settings" | "audit";
type SortKey = "date" | "workshop" | "time" | "status" | "name";
type ModalState =
  | { kind: "add" }
  | { kind: "move"; booking: AdminBooking }
  | { kind: "remove"; booking: AdminBooking }
  | null;

export default function AdminApp({ initialConfig, realtime }: { initialConfig: EventConfig; realtime: RealtimeInfo }) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<{ availability: Availability; registrations: AdminBooking[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [modal, setModal] = useState<ModalState>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { toast, show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const fmtTs = useCallback(
    (iso: string | null, style: "short" | "full" = "short") =>
      iso
        ? new Date(iso).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: style === "short" ? "short" : "medium",
            timeZone: config.event.timezone,
          })
        : "",
    [config.event.timezone],
  );
  const label = useCallback((t: string) => topicLabel(config, t), [config]);

  const load = useCallback(async () => {
    const { status, data } = await api<{ availability: Availability; registrations: AdminBooking[] }>("/api/admin/data").catch(() => ({
      status: 0,
      data: null as never,
    }));
    if (status === 401) {
      setAuthed(false);
      return false;
    }
    if (status !== 200 || !data) {
      setLoadError("Couldn't load registrations. Retrying automatically…");
      return false;
    }
    setAuthed(true);
    setLoadError("");
    setData(data);
    return true;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: reload whenever the database reports a change (Realtime or 12 s polling).
  const { availability: liveAvail } = useAvailability(realtime, authed === true, "admin", () => void load());
  const availability = liveAvail ?? data?.availability ?? null;
  const sess = useMemo(() => {
    const m: Record<string, SessionAvail> = {};
    availability?.sessions.forEach((s) => (m[s.id] = s));
    return m;
  }, [availability]);

  const sessionLabel = useCallback(
    (sid: string) => {
      const s = sess[sid];
      return s ? `${label(s.topic)} · ${s.timeSlot}` : sid;
    },
    [sess, label],
  );

  const promoText = (promos: Promoted[] | undefined) =>
    promos?.length ? (
      <>
        {" "}
        Promoted from waitlist:{" "}
        {promos.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ", "}
            <strong>{p.name}</strong> ({sessionLabel(p.sessionId)})
          </span>
        ))}
        . Let them know.
      </>
    ) : null;

  const logout = async () => {
    await api("/api/admin/logout", {});
    router.push("/");
  };

  if (authed === false) {
    return (
      <>
        <Header config={config} participants={availability?.participants ?? null} isAdminView onBack={() => router.push("/")} />
        <div className="shell">
          <main id="mainCol" className="login-page" />
        </div>
        <AdminLoginModal
          onClose={() => router.push("/")}
          onSuccess={() => {
            setAuthed(null);
            void load();
          }}
        />
      </>
    );
  }

  /* ---------- registrations table ---------- */

  const regs = data?.registrations ?? [];
  const q = search.toLowerCase();
  const sorters: Record<SortKey, (a: AdminBooking, b: AdminBooking) => number> = {
    date: (a, b) => b.createdAt.localeCompare(a.createdAt),
    workshop: (a, b) => a.topic.localeCompare(b.topic) || a.timeSlot.localeCompare(b.timeSlot),
    time: (a, b) => a.timeSlot.localeCompare(b.timeSlot) || a.topic.localeCompare(b.topic),
    name: (a, b) => a.name.localeCompare(b.name) || a.timeSlot.localeCompare(b.timeSlot),
    status: (a, b) => a.status.localeCompare(b.status) || a.topic.localeCompare(b.topic),
  };
  const rows = regs
    .filter(
      (r) =>
        !q || r.name.toLowerCase().includes(q) || r.email.includes(q) || label(r.topic).toLowerCase().includes(q) || r.timeSlot.includes(q),
    )
    .sort(sorters[sort]);
  const people = availability?.participants ?? new Set(regs.map((r) => r.email)).size;
  const th = (k: SortKey, text: string) => (
    <th className="sortable" aria-sort={sort === k ? "ascending" : undefined}>
      <button className="link-btn" style={{ color: "inherit", textDecoration: "none" }} onClick={() => setSort(k)}>
        {text} {sort === k ? "▾" : ""}
      </button>
    </th>
  );

  const importJson = async (f: File) => {
    try {
      const rowsIn = JSON.parse(await f.text());
      if (!Array.isArray(rowsIn)) return alert("Invalid file format.");
      const { status, data } = await api<{ ok: boolean; added: number; skipped: number; error?: string }>("/api/admin/import", { rows: rowsIn });
      if (status !== 200 || !data?.ok) return alert(data?.error ?? "Import failed.");
      alert(`Imported ${data.added} booking(s). ${data.skipped} skipped (already present or invalid).`);
      await load();
    } catch {
      alert("Could not read that JSON file.");
    }
  };

  const dashboard = (
    <>
      <p className="lede">
        {people} participant{people === 1 ? "" : "s"} · {regs.length} booking{regs.length === 1 ? "" : "s"} across{" "}
        {availability?.sessions.length ?? 0} sessions.
      </p>
      <div className="section-h">Registrations</div>
      <div className="admin-tools">
        <input
          type="search"
          aria-label="Search registrations"
          placeholder="Search name, email, session or time…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Sort registrations" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="date">Newest first</option>
          <option value="workshop">By session</option>
          <option value="time">By time</option>
          <option value="status">By status</option>
          <option value="name">By name</option>
        </select>
        <button className="btn-primary" style={{ padding: "7px 14px", fontSize: ".83rem" }} onClick={() => setModal({ kind: "add" })}>
          + Add person
        </button>
        <button
          className="btn-secondary"
          style={{ padding: "7px 14px", fontSize: ".83rem" }}
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            const ok = await load();
            setRefreshing(false);
            show(ok ? "Data refreshed." : "Couldn't refresh right now.", 2000);
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="admin-tools">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from an API route */}
        <a className="btn-secondary" style={{ padding: "7px 14px", fontSize: ".83rem", textDecoration: "none" }} href="/api/admin/export?type=people" aria-disabled={!regs.length}>
          Export CSV (one row per person)
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from an API route */}
        <a className="btn-secondary" style={{ padding: "7px 14px", fontSize: ".83rem", textDecoration: "none" }} href="/api/admin/export?type=detail">
          Detailed CSV
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from an API route */}
        <a className="btn-secondary" style={{ padding: "7px 14px", fontSize: ".83rem", textDecoration: "none" }} href="/api/admin/export?type=backup">
          Backup JSON
        </a>
        <button className="btn-secondary" style={{ padding: "7px 14px", fontSize: ".83rem" }} onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <input
          type="file"
          ref={fileRef}
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importJson(f);
          }}
        />
      </div>
      {loadError && <div className="error-box">{loadError}</div>}
      <div className="tbl-wrap">
        {!data ? (
          <div className="empty">Loading…</div>
        ) : rows.length ? (
          <table className="data">
            <thead>
              <tr>
                {th("name", "Name")}
                <th>Email</th>
                {th("workshop", "Session")}
                {th("time", "Time")}
                {th("status", "Status")}
                {th("date", "Registered")}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{label(r.topic)}</td>
                  <td>{r.timeSlot}</td>
                  <td>
                    <StatusBadge status={r.status} position={r.waitlistPosition} />
                    {r.promotedAt && r.status === "confirmed" && (
                      <span className="status-badge promo" title={`Promoted ${fmtTs(r.promotedAt, "full")}`}>
                        Promoted
                      </span>
                    )}
                    {r.forced && (
                      <span className="status-badge forced" title="Seat guaranteed by admin">
                        Override
                      </span>
                    )}
                  </td>
                  <td>
                    {fmtTs(r.createdAt)}
                    {r.source === "admin" && <span style={{ color: "var(--ink-3)" }}> (admin)</span>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-small" onClick={() => setModal({ kind: "move", booking: r })} aria-label={`Move ${r.name}`}>
                        Move
                      </button>
                      <button
                        className="btn-small danger"
                        onClick={() => setModal({ kind: "remove", booking: r })}
                        aria-label={`Remove ${r.name} from ${label(r.topic)}`}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <div className="icon" aria-hidden>
              ▦
            </div>
            {regs.length ? "No registrations match your search." : "No registrations yet. Use “Add person” to book someone manually."}
          </div>
        )}
      </div>
      <div className="section-h">Capacity overview</div>
      <div className="tbl-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Session</th>
              <th>Confirmed</th>
              <th>Waitlist</th>
              <th>Status</th>
              <th>Confirmed fill</th>
            </tr>
          </thead>
          <tbody>
            {availability?.sessions.map((s) => {
              const pct = s.confirmedCap ? Math.min(100, Math.round((s.confirmedCount / s.confirmedCap) * 100)) : 100;
              const col =
                s.state === "full" ? "var(--red)" : s.state === "waitlist" ? "#E0A800" : s.seatsLeft >= Math.ceil(s.confirmedCap * 0.5) ? "var(--green)" : "var(--yellow)";
              return (
                <tr key={s.id}>
                  <td>
                    {s.kind === "workshop" ? s.topic : s.label || s.topic} · {s.timeSlot}
                  </td>
                  <td>
                    {s.confirmedCount} / {s.confirmedCap}
                    {s.forcedCount > 0 && <span className="muted"> ({s.forcedCount} guaranteed)</span>}
                  </td>
                  <td>
                    {s.waitlistCount > 0 ? <strong style={{ color: "#8A6D00" }}>{s.waitlistCount}</strong> : "0"} / {s.waitlistCap}
                  </td>
                  <td>
                    <SeatPill s={s} />
                  </td>
                  <td>
                    <div className="cap-bar" role="img" aria-label={`${pct}% of confirmed seats filled`}>
                      <i style={{ width: `${pct}%`, background: col }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <>
      <Header config={config} participants={availability?.participants ?? null} isAdminView onBack={() => router.push("/")} />
      <div className="shell" style={{ gridTemplateColumns: "1fr" }}>
        <main id="mainCol">
          <div className="admin panel">
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h1>Admin dashboard</h1>
              <span style={{ flex: 1 }} />
              <button className="link-btn" onClick={logout}>
                Sign out
              </button>
            </div>
            <div className="admin-tabs" role="tablist">
              {(
                [
                  ["dashboard", "Registrations & capacity"],
                  ["settings", "Event settings"],
                  ["audit", "Audit log"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>
            {tab === "dashboard" && dashboard}
            {tab === "settings" && (
              <SettingsPanel
                config={config}
                sessions={availability?.sessions ?? []}
                onSaved={(c, msg) => {
                  setConfig(c);
                  show(msg, 8000);
                  void load();
                  router.refresh();
                }}
              />
            )}
            {tab === "audit" && <AuditPanel fmtTs={fmtTs} sessionLabel={sessionLabel} />}
          </div>
        </main>
      </div>

      {modal?.kind === "add" && (
        <AddModal
          config={config}
          sess={sess}
          regs={regs}
          onClose={() => setModal(null)}
          onDone={(b, promos) => {
            setModal(null);
            show(
              <>
                Added <strong>{b.name}</strong> to {sessionLabel(b.sessionId)} ({b.status === "waitlist" ? "waitlist" : "confirmed"}).
                {promoText(promos)}
              </>,
            );
            void load();
          }}
        />
      )}
      {modal?.kind === "move" && (
        <MoveModal
          config={config}
          sess={sess}
          booking={modal.booking}
          sessionLabel={sessionLabel}
          onClose={() => setModal(null)}
          onGone={() => {
            setModal(null);
            show("That booking no longer exists — it may have been cancelled.");
            void load();
          }}
          onDone={(b, promos) => {
            setModal(null);
            show(
              <>
                Moved <strong>{b.name}</strong> to {sessionLabel(b.sessionId)} ({b.status}).{promoText(promos)}
              </>,
              8000,
            );
            void load();
          }}
        />
      )}
      {modal?.kind === "remove" && (
        <RemoveModal
          booking={modal.booking}
          sessionLabel={sessionLabel}
          onClose={() => setModal(null)}
          onDone={(promos) => {
            const b = modal.booking;
            setModal(null);
            show(
              <>
                Removed <strong>{b.name}</strong> from {sessionLabel(b.sessionId)}.{promoText(promos)}
              </>,
              8000,
            );
            void load();
          }}
        />
      )}
      <Toast toast={toast} />
    </>
  );
}

/* ================= Modals ================= */

function SessionOptions({ config, sess }: { config: EventConfig; sess: Record<string, SessionAvail> }) {
  const all = Object.values(sess).sort((a, b) => a.sortOrder - b.sortOrder);
  const g = eveningTopic(config);
  const topics = [config.plenary.topic, ...config.workshops.topics.map((t) => t.key), ...(g ? [g] : [])];
  return (
    <>
      {topics.map((t) => (
        <optgroup key={t} label={topicLabel(config, t)}>
          {all
            .filter((s) => s.topic === t)
            .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.timeSlot} — {s.state === "open" ? `${s.seatsLeft} seats left` : s.state === "waitlist" ? `waitlist, ${s.waitlistLeft} left` : "full"}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function AddModal({
  config,
  sess,
  regs,
  onClose,
  onDone,
}: {
  config: EventConfig;
  sess: Record<string, SessionAvail>;
  regs: AdminBooking[];
  onClose: () => void;
  onDone: (b: AdminBooking, promos: Promoted[]) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sid, setSid] = useState(() => Object.values(sess).sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? "");
  const [forced, setForced] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr("");
    const { data } = await api("/api/admin/add", { name, email, sessionId: sid, forced }).catch(() => ({ data: null }));
    setBusy(false);
    if (!data?.ok) return setErr(data?.error ?? "Couldn't save. Please try again.");
    onDone(data.booking, data.promoted ?? []);
  };
  return (
    <Modal onClose={onClose} wide label="Add person">
      <h2>Add person</h2>
      <p style={{ textAlign: "left" }}>Book someone into a session. The same clash rules apply as for self-registration.</p>
      <div className="mfield">
        <label htmlFor="mName">Full name</label>
        <input id="mName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="mfield">
        <label htmlFor="mEmail">Email</label>
        <input
          id="mEmail"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            const f = regs.find((r) => r.email === e.target.value.trim().toLowerCase());
            if (f && !name.trim()) setName(f.name);
          }}
        />
      </div>
      <div className="mfield">
        <label htmlFor="mSess">Session</label>
        <select id="mSess" value={sid} onChange={(e) => setSid(e.target.value)}>
          <SessionOptions config={config} sess={sess} />
        </select>
      </div>
      <label className="mcheck">
        <input type="checkbox" checked={forced} onChange={(e) => setForced(e.target.checked)} /> Guarantee a confirmed seat, even if this takes the
        session over capacity
      </label>
      <div className="err" style={{ textAlign: "left" }} role="alert">
        {err}
      </div>
      <div className="btn-row">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          Add person
        </button>
      </div>
    </Modal>
  );
}

function MoveModal({
  config,
  sess,
  booking,
  sessionLabel,
  onClose,
  onDone,
  onGone,
}: {
  config: EventConfig;
  sess: Record<string, SessionAvail>;
  booking: AdminBooking;
  sessionLabel: (sid: string) => string;
  onClose: () => void;
  onDone: (b: AdminBooking, promos: Promoted[]) => void;
  onGone: () => void;
}) {
  const [sid, setSid] = useState(booking.sessionId);
  const [forced, setForced] = useState(booking.forced);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (sid === booking.sessionId && forced === booking.forced) return onClose();
    setBusy(true);
    setErr("");
    const { data } = await api("/api/admin/move", { id: booking.id, sessionId: sid, forced }).catch(() => ({ data: null }));
    setBusy(false);
    if (data?.gone) return onGone();
    if (!data?.ok) return setErr(data?.error ?? "Couldn't save. Please try again.");
    onDone(data.booking, data.promoted ?? []);
  };
  return (
    <Modal onClose={onClose} wide label="Move person">
      <h2>Move person</h2>
      <div className="current">
        <strong>{booking.name}</strong> · {booking.email}
        <br />
        Currently: {sessionLabel(booking.sessionId)} ({booking.status})
      </div>
      <div className="mfield">
        <label htmlFor="mSess">Move to</label>
        <select id="mSess" value={sid} onChange={(e) => setSid(e.target.value)}>
          <SessionOptions config={config} sess={sess} />
        </select>
      </div>
      <label className="mcheck">
        <input type="checkbox" checked={forced} onChange={(e) => setForced(e.target.checked)} /> Guarantee a confirmed seat, even if this takes the
        session over capacity
      </label>
      <p style={{ textAlign: "left", fontSize: ".78rem", margin: "0 0 4px" }}>
        Moving to a different session puts them at the back of that session&apos;s queue unless the box is ticked.
      </p>
      <div className="err" style={{ textAlign: "left" }} role="alert">
        {err}
      </div>
      <div className="btn-row">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          Move
        </button>
      </div>
    </Modal>
  );
}

function RemoveModal({
  booking,
  sessionLabel,
  onClose,
  onDone,
}: {
  booking: AdminBooking;
  sessionLabel: (sid: string) => string;
  onClose: () => void;
  onDone: (promos: Promoted[]) => void;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const { data } = await api("/api/admin/remove", { id: booking.id }).catch(() => ({ data: null }));
    setBusy(false);
    if (data?.gone) return onDone([]);
    if (!data?.ok) return setErr("Couldn't remove right now. Please try again.");
    onDone(data.promoted ?? []);
  };
  return (
    <Modal onClose={onClose} label="Remove booking?">
      <h2>Remove booking?</h2>
      <p>
        {booking.name} will be removed from {sessionLabel(booking.sessionId)}. If the session has a waitlist, the next person moves up automatically.
      </p>
      <div className="err" role="alert">
        {err}
      </div>
      <div className="btn-row" style={{ justifyContent: "center" }}>
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-danger" onClick={submit} disabled={busy}>
          Remove
        </button>
      </div>
    </Modal>
  );
}

/* ================= Settings ================= */

function SettingsPanel({
  config,
  sessions,
  onSaved,
}: {
  config: EventConfig;
  sessions: SessionAvail[];
  onSaved: (c: EventConfig, msg: string) => void;
}) {
  const [draft, setDraft] = useState<EventConfig>(() => structuredClone(config));
  const [json, setJson] = useState(() => JSON.stringify(config, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"form" | "json">("form");

  const setEvent = (k: keyof EventConfig["event"], v: string) => setDraft({ ...draft, event: { ...draft.event, [k]: v } });
  const defs = useMemo(() => buildSessions(draft), [draft]);
  const counts = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions]);

  const setCap = (id: string, key: "confirmedCap" | "waitlistCap", raw: string) => {
    const v = raw === "" ? undefined : Math.max(0, Math.floor(Number(raw)));
    const o = { ...(draft.capacityOverrides[id] ?? {}) };
    const def = defs.find((d) => d.id === id);
    const typeCaps =
      def?.kind === "plenary" ? draft.plenary : def?.kind === "social" && draft.evening.registration ? draft.evening.registration : draft.workshops;
    const typeDefault = typeCaps[key];
    if (v === undefined || v === typeDefault || Number.isNaN(v)) delete o[key];
    else o[key] = v;
    const next = { ...draft.capacityOverrides };
    if (Object.keys(o).length) next[id] = o;
    else delete next[id];
    setDraft({ ...draft, capacityOverrides: next });
  };

  const save = async (cfg: EventConfig) => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const { status, data } = await api("/api/admin/config", { config: cfg }).catch(() => ({ status: 0, data: null }));
    setBusy(false);
    if (status !== 200 || !data?.ok) {
      setErrors(data?.errors ?? [data?.message ?? "Couldn't save the settings. Please try again."]);
      return;
    }
    const inactive: string[] = data.inactiveWithBookings ?? [];
    const promos: Promoted[] = data.promoted ?? [];
    setJson(JSON.stringify(cfg, null, 2));
    setDraft(structuredClone(cfg));
    onSaved(
      cfg,
      [
        "Settings saved.",
        promos.length ? `${promos.length} waitlisted booking(s) were promoted — check the Promoted badges.` : "",
        inactive.length ? `Hidden but kept (they still have bookings): ${inactive.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const n = (v: number | undefined) => (v === undefined ? "" : String(v));

  return (
    <div>
      <p className="lede">
        Everything here is stored in the database — no code change or redeploy needed. Changing a capacity re-derives confirmed and waitlist
        places immediately (raising it promotes people from the waitlist). Sessions that still hold bookings are never deleted.
      </p>
      <div className="admin-tabs" role="tablist" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={mode === "form"} onClick={() => setMode("form")}>
          Event & capacities
        </button>
        <button
          role="tab"
          aria-selected={mode === "json"}
          onClick={() => {
            setJson(JSON.stringify(draft, null, 2));
            setMode("json");
          }}
        >
          Advanced (timetable, topics, branding)
        </button>
      </div>
      {errors.length > 0 && (
        <div className="config-error" role="alert">
          <strong>Please fix the following:</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {mode === "form" ? (
        <>
          <div className="section-h">Event</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "0 18px", maxWidth: 900 }}>
            {(
              [
                ["name", "Event name"],
                ["tagline", "Tagline"],
                ["dateLabel", "Date (as shown)"],
                ["shortDateLabel", "Short date (success screen)"],
                ["venue", "Venue"],
                ["dayStart", "Day starts"],
                ["dayEnd", "Day ends"],
                ["timezone", "Timezone (IANA)"],
              ] as const
            ).map(([k, l]) => (
              <div className="field" key={k}>
                <label htmlFor={`ev-${k}`}>{l}</label>
                <input id={`ev-${k}`} value={draft.event[k] ?? ""} onChange={(e) => setEvent(k, e.target.value)} />
              </div>
            ))}
            <div className="field">
              <label htmlFor="ev-domains">Allowed email domains</label>
              <input
                id="ev-domains"
                placeholder="empty = any domain, e.g. bshg.com"
                value={draft.registration.allowedEmailDomains.join(", ")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    registration: {
                      ...draft.registration,
                      allowedEmailDomains: e.target.value
                        .split(/[,\s]+/)
                        .map((x) => x.trim().replace(/^@/, "").toLowerCase())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </div>
          </div>
          <div className="section-h" style={{ marginTop: 10 }}>
            Default capacities
          </div>
          <div className="admin-tools" style={{ gap: 18 }}>
            <label>
              {draft.plenary.topic} confirmed{" "}
              <input
                className="cap-input"
                type="number"
                min={0}
                value={draft.plenary.confirmedCap}
                onChange={(e) => setDraft({ ...draft, plenary: { ...draft.plenary, confirmedCap: Number(e.target.value) } })}
              />
            </label>
            <label>
              {draft.plenary.topic} waitlist{" "}
              <input
                className="cap-input"
                type="number"
                min={0}
                value={draft.plenary.waitlistCap}
                onChange={(e) => setDraft({ ...draft, plenary: { ...draft.plenary, waitlistCap: Number(e.target.value) } })}
              />
            </label>
            <label>
              Workshop confirmed{" "}
              <input
                className="cap-input"
                type="number"
                min={0}
                value={draft.workshops.confirmedCap}
                onChange={(e) => setDraft({ ...draft, workshops: { ...draft.workshops, confirmedCap: Number(e.target.value) } })}
              />
            </label>
            <label>
              Workshop waitlist{" "}
              <input
                className="cap-input"
                type="number"
                min={0}
                value={draft.workshops.waitlistCap}
                onChange={(e) => setDraft({ ...draft, workshops: { ...draft.workshops, waitlistCap: Number(e.target.value) } })}
              />
            </label>
            {draft.evening.registration && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.evening.registration.enabled}
                    onChange={(e) =>
                      setDraft({ ...draft, evening: { ...draft.evening, registration: { ...draft.evening.registration!, enabled: e.target.checked } } })
                    }
                  />{" "}
                  Gathering needs registration
                </label>
                <label>
                  Gathering places{" "}
                  <input
                    className="cap-input"
                    type="number"
                    min={0}
                    value={draft.evening.registration.confirmedCap}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        evening: { ...draft.evening, registration: { ...draft.evening.registration!, confirmedCap: Number(e.target.value) } },
                      })
                    }
                  />
                </label>
                <label>
                  Gathering waitlist{" "}
                  <input
                    className="cap-input"
                    type="number"
                    min={0}
                    value={draft.evening.registration.waitlistCap}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        evening: { ...draft.evening, registration: { ...draft.evening.registration!, waitlistCap: Number(e.target.value) } },
                      })
                    }
                  />
                </label>
              </>
            )}
          </div>
          <div className="section-h">Per-session capacity</div>
          <div className="tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Currently held</th>
                  <th>Confirmed cap</th>
                  <th>Waitlist cap</th>
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.label || d.topic} · {d.timeSlot}
                    </td>
                    <td className="muted">
                      {counts[d.id] ? `${counts[d.id].confirmedCount} confirmed · ${counts[d.id].waitlistCount} waitlist` : "—"}
                    </td>
                    <td>
                      <input
                        className="cap-input"
                        type="number"
                        min={0}
                        aria-label={`Confirmed capacity for ${d.topic} ${d.timeSlot}`}
                        value={n(d.confirmedCap)}
                        onChange={(e) => setCap(d.id, "confirmedCap", e.target.value)}
                      />
                      {draft.capacityOverrides[d.id]?.confirmedCap !== undefined && <span className="muted"> custom</span>}
                    </td>
                    <td>
                      <input
                        className="cap-input"
                        type="number"
                        min={0}
                        aria-label={`Waitlist capacity for ${d.topic} ${d.timeSlot}`}
                        value={n(d.waitlistCap)}
                        onChange={(e) => setCap(d.id, "waitlistCap", e.target.value)}
                      />
                      {draft.capacityOverrides[d.id]?.waitlistCap !== undefined && <span className="muted"> custom</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => setDraft(structuredClone(config))} disabled={busy}>
              Discard changes
            </button>
            <button className="btn-primary" onClick={() => save(draft)} disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="lede" style={{ marginBottom: 10 }}>
            Full event configuration as JSON: plenary sessions, workshop topics and descriptions, time rows, the rotation grid, the evening
            gathering, logos and brand colours. Session ids are derived from topic + time, so renaming a topic or changing a time creates a new
            session.
          </p>
          <label htmlFor="cfgJson" className="sr-only">
            Event configuration JSON
          </label>
          <textarea id="cfgJson" className="cfg-editor" spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => setJson(JSON.stringify(config, null, 2))} disabled={busy}>
              Discard changes
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => {
                try {
                  void save(JSON.parse(json));
                } catch (e) {
                  setErrors([`That isn't valid JSON: ${(e as Error).message}`]);
                }
              }}
            >
              {busy ? "Saving…" : "Validate & save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ================= Audit ================= */

function AuditPanel({ fmtTs, sessionLabel }: { fmtTs: (iso: string | null, s?: "short" | "full") => string; sessionLabel: (sid: string) => string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    void api<AuditEntry[]>("/api/admin/audit").then(({ data }) => setRows(Array.isArray(data) ? data : []));
  }, []);
  const q = filter.toLowerCase();
  const shown = (rows ?? []).filter(
    (r) => !q || [r.action, r.actor, r.name, r.email, r.session_id].some((x) => String(x ?? "").toLowerCase().includes(q)),
  );
  const describe = (r: AuditEntry) => {
    const d = r.detail ?? {};
    if (r.action === "move") return `${sessionLabel(String(d.from))} → ${sessionLabel(String(d.to))}${d.forced ? " (guaranteed)" : ""}`;
    if (r.action === "config") return `${d.sessions} sessions`;
    if (d.status) return String(d.status);
    return "";
  };
  return (
    <div>
      <p className="lede">
        Append-only record of every booking, cancellation, removal, move, promotion and settings change. Use it to reconcile the final attendee
        list. Showing the latest 1,000 entries.
      </p>
      <div className="admin-tools">
        <input type="search" aria-label="Filter audit log" placeholder="Filter by action, name, email or session…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="tbl-wrap">
        {!rows ? (
          <div className="empty">Loading…</div>
        ) : shown.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>By</th>
                <th>Name</th>
                <th>Email</th>
                <th>Session</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTs(r.at, "full")}</td>
                  <td>{r.action}</td>
                  <td>{r.actor}</td>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.session_id ? sessionLabel(r.session_id) : ""}</td>
                  <td className="muted">{describe(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No entries yet.</div>
        )}
      </div>
    </div>
  );
}
