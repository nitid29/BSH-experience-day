"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { emailDomainAllowed, eveningTopic, sessionId, topicLabel, type EventConfig } from "@/lib/config";
import { api, firstName, indexSessions, normEmail, useAvailability, useToast, validEmail, type RealtimeInfo } from "@/lib/client";
import type { BookOutcome, BookResponse, MyBooking } from "@/lib/types";
import { AdminLoginModal, ErrorBox, Header, Modal, NoteBox, SeatPill, StatusBadge, Timetable, Toast } from "./ui";

type Step = 1 | 1.5 | 2 | 3 | 4 | 5;

const GENERIC_SAVE_ERROR =
  "We couldn't save your registration, so nothing was booked. Please try again in a moment. If it keeps failing, contact the organising team.";

export default function RegistrationApp({ config, realtime }: { config: EventConfig; realtime: RealtimeInfo }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(""); // committed identity (after Continue)
  const [emailInput, setEmailInput] = useState("");
  const [autoName, setAutoName] = useState(false);
  const [found, setFound] = useState<{ email: string; count: number; name: string | null } | null>(null);
  const [mine, setMine] = useState<MyBooking[]>([]);
  const [selTopics, setSelTopics] = useState<string[]>([]);
  const [selSlots, setSelSlots] = useState<Record<string, string>>({});
  const [justFilled, setJustFilled] = useState<string[]>([]);
  const [lastNewIds, setLastNewIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<MyBooking | null>(null);
  const [swapTarget, setSwapTarget] = useState<MyBooking | null>(null);
  // Sessions that still showed free seats when the person clicked "Confirm" (to spot "filled up meanwhile").
  const [predictedOpen, setPredictedOpen] = useState<string[]>([]);
  const [cancelErr, setCancelErr] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { toast, show } = useToast();

  const P = config.plenary.topic;
  const G = eveningTopic(config); // bookable evening gathering, if registration is enabled
  const gSid = G ? sessionId(G, config.evening.time) : null;
  const allTopics = [P, ...config.workshops.topics.map((t) => t.key), ...(G ? [G] : [])];
  const label = useCallback((t: string) => topicLabel(config, t), [config]);

  /* ---------- data ---------- */

  const loadMine = useCallback(async (e: string) => {
    const { status, data } = await api<{ ok: boolean; name: string | null; bookings: MyBooking[] }>("/api/lookup", { email: e });
    if (status !== 200 || !data?.ok) throw new Error("lookup failed");
    return data;
  }, []);

  const refreshMine = useCallback(async () => {
    if (!email) return;
    try {
      setMine((await loadMine(email)).bookings);
    } catch {
      /* keep what we have */
    }
  }, [email, loadMine]);

  const { availability, live, refresh: refreshAvail } = useAvailability(
    realtime,
    step >= 1.5 && step <= 5,
    step,
    () => void refreshMine(),
  );
  const sess = useMemo(() => indexSessions(availability), [availability]);

  /* ---------- helpers ---------- */

  const bookedByTopic = useMemo(() => {
    const m: Record<string, MyBooking> = {};
    mine.forEach((r) => (m[r.topic] = r));
    return m;
  }, [mine]);

  const timeOf = useCallback((sid: string) => sess[sid]?.timeSlot ?? "", [sess]);

  /** Same rules everywhere: one session per topic (so only one plenary), one session per time slot. */
  const ruleCheck = useCallback(
    (sid: string): string | null => {
      const s = sess[sid];
      if (!s) return "that session doesn't exist";
      if (mine.some((r) => r.sessionId === sid)) return "already booked for this session";
      const sameTopic = mine.find((r) => r.topic === s.topic);
      if (sameTopic)
        return s.kind === "plenary"
          ? `already booked for the ${label(s.topic)} session at ${sameTopic.timeSlot} (only one of the two is allowed)`
          : `already booked for ${label(s.topic)} at ${sameTopic.timeSlot}`;
      const sameTime = mine.find((r) => r.timeSlot === s.timeSlot);
      if (sameTime) return `already booked for ${label(sameTime.topic)} at ${s.timeSlot}`;
      return null;
    },
    [sess, mine, label],
  );

  const goStep = useCallback((n: Step, keepError = false) => {
    setStep(n);
    if (!keepError) setSubmitError(null);
    window.scrollTo({ top: 0 });
  }, []);

  // Move focus to the new screen's heading for keyboard and screen-reader users.
  useEffect(() => {
    if (step !== 1) headingRef.current?.focus();
  }, [step]);

  /* ---------- keep selections valid as live data changes (PRD 8.15) ---------- */

  useEffect(() => {
    if (!availability) return;
    const next = { ...selSlots };
    const filled: string[] = [];
    let changed = false;
    for (const [topic, sid] of Object.entries(selSlots)) {
      const s = sess[sid];
      const clash = Object.entries(next).some(([k, id]) => k !== topic && sess[id]?.timeSlot === s?.timeSlot);
      if (!s || s.state === "full" || ruleCheck(sid) || clash || !selTopics.includes(topic)) {
        if (s?.state === "full") filled.push(sid);
        delete next[topic];
        changed = true;
      }
    }
    // Live data (availability / bookings) changed underneath the user's selection: reconcile it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (changed) setSelSlots(next);
    if (filled.length) setJustFilled((j) => [...new Set([...j, ...filled])]);
    // drop topics that have since been booked (e.g. in another tab)
    const keep = selTopics.filter((t) => !bookedByTopic[t]);
    if (keep.length !== selTopics.length) setSelTopics(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability, mine]);

  /* ---------- step 1: email lookup while typing ---------- */

  const emailNorm = normEmail(emailInput);
  const domainOk = emailDomainAllowed(config, emailNorm);
  const emailValid = validEmail(emailNorm) && domainOk;
  const nameState = useRef({ name, autoName });
  useEffect(() => {
    nameState.current = { name, autoName };
  }, [name, autoName]);

  useEffect(() => {
    if (step !== 1 || !validEmail(emailNorm)) return;
    const t = setTimeout(async () => {
      try {
        const d = await loadMine(emailNorm);
        setFound({ email: emailNorm, count: d.bookings.length, name: d.name });
        // Prefill the stored name for a returning email (unless the user typed their own).
        const cur = nameState.current;
        if (d.bookings.length && d.name && (!cur.name.trim() || cur.autoName)) {
          setName(d.name);
          setAutoName(true);
        }
      } catch {
        setFound(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [emailNorm, step, loadMine]);

  const onEmailInput = (v: string) => {
    setEmailInput(v);
    if (autoName) {
      setName("");
      setAutoName(false);
    }
  };

  const continueFromStep1 = async () => {
    setBusy(true);
    try {
      const d = await loadMine(emailNorm);
      if (email && email !== emailNorm) {
        setSelTopics([]);
        setSelSlots({});
      }
      setEmail(emailNorm);
      setName(name.trim());
      setMine(d.bookings);
      setJustFilled([]);
      await refreshAvail();
      goStep(d.bookings.length ? 1.5 : 2);
    } catch {
      setSubmitError("We couldn't reach the registration service. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const resetFlow = () => {
    setStep(1);
    setName("");
    setEmail("");
    setEmailInput("");
    setAutoName(false);
    setFound(null);
    setMine([]);
    setSelTopics([]);
    setSelSlots({});
    setJustFilled([]);
    setLastNewIds([]);
    setSubmitError(null);
    window.scrollTo({ top: 0 });
  };

  /* ---------- submit ---------- */

  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    const ids = selTopics.map((t) => selSlots[t]).filter(Boolean);
    setPredictedOpen(ids.filter((id) => sess[id]?.state === "open"));
    let res: { status: number; data: BookResponse };
    try {
      res = await api<BookResponse>("/api/book", { name, email, sessionIds: ids, website: honeypot.current?.value ?? "" });
    } catch {
      setBusy(false);
      setSubmitError(GENERIC_SAVE_ERROR);
      return;
    }
    const d = res.data;
    if (res.status === 200 && d?.ok) {
      setLastNewIds(d.outcomes.map((o) => o.id!).filter(Boolean));
      await refreshMine();
      await refreshAvail();
      setSelTopics([]);
      setSelSlots({});
      setJustFilled([]);
      setBusy(false);
      goStep(5);
      return;
    }
    setBusy(false);
    if (res.status === 429) return setSubmitError((d && !d.ok && d.message) || "Too many requests. Please wait a minute and try again.");
    if (d && !d.ok && d.error === "invalid_email") {
      setSubmitError(emailDomainMessage());
      return goStep(1, true);
    }
    if (d && !d.ok && (d.error === "rejected" || d.error === "conflict")) {
      const latest = await loadMine(email).catch(() => null);
      const bookings = latest?.bookings ?? mine;
      if (latest) setMine(bookings);
      await refreshAvail();
      const problems: string[] = [];
      const nextSlots = { ...selSlots };
      let nextTopics = [...selTopics];
      for (const o of (d.outcomes ?? []) as BookOutcome[]) {
        if (o.result !== "rejected") continue;
        const t = o.topic ?? "";
        const when = o.timeSlot ?? timeOf(o.sessionId);
        if (o.reason?.startsWith("rule:")) {
          problems.push(`${label(t)} at ${when}: you're ${o.reason.slice(5)}.`);
          if (bookings.some((b) => b.topic === t)) nextTopics = nextTopics.filter((x) => x !== t);
        } else if (o.reason === "full") {
          problems.push(`${label(t)} at ${when} filled up completely (including the waitlist) while you were registering. Please pick another time.`);
          setJustFilled((j) => [...new Set([...j, o.sessionId])]);
        } else {
          problems.push(`${label(t) || o.sessionId} is no longer available. Please pick another session.`);
        }
        delete nextSlots[t];
      }
      if (!problems.length) problems.push("Please review your time slots.");
      setSelTopics(nextTopics);
      setSelSlots(nextSlots);
      setSubmitError(
        <>
          Some of your choices changed while you were registering. Nothing has been saved yet.
          {problems.map((p, i) => (
            <Fragment key={i}>
              <br />
              {p}
            </Fragment>
          ))}
        </>,
      );
      if (!nextTopics.length) return goStep(bookings.length ? 1.5 : 2, true);
      return goStep(3, true);
    }
    setSubmitError(d && "message" in d && d.message ? d.message : GENERIC_SAVE_ERROR);
  };

  const emailDomainMessage = () => {
    const doms = config.registration.allowedEmailDomains;
    return doms.length ? `Please use your company email address (${doms.map((x) => "@" + x.replace(/^@/, "")).join(" or ")}).` : "Please enter a valid email address.";
  };

  /* ---------- cancel own booking ---------- */

  const doCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    const { status, data } = await api("/api/cancel", { email, bookingId: cancelTarget.id }).catch(() => ({ status: 0, data: null }));
    setBusy(false);
    if (status !== 200 || !data?.ok) {
      if (data?.error === "not_found") {
        setCancelTarget(null);
        await refreshMine();
        show("That booking was already cancelled.");
        return;
      }
      setCancelErr("Couldn't cancel right now. Please try again.");
      return;
    }
    const t = cancelTarget;
    setCancelTarget(null);
    await refreshMine();
    await refreshAvail();
    show(
      <>
        Your {label(t.topic)} booking at {t.timeSlot} was cancelled.
      </>,
    );
  };

  /* ---------- leave a waitlist and choose another time ---------- */

  /** Other sessions of the same topic that still take bookings and don't clash with the person's other bookings. */
  const alternativesFor = (b: MyBooking) =>
    Object.values(sess).filter(
      (s) =>
        s.topic === b.topic &&
        s.id !== b.sessionId &&
        s.state !== "full" &&
        !mine.some((r) => r.id !== b.id && r.timeSlot === s.timeSlot),
    );

  const doSwap = async () => {
    if (!swapTarget) return;
    const t = swapTarget;
    setBusy(true);
    const { status, data } = await api("/api/cancel", { email, bookingId: t.id }).catch(() => ({ status: 0, data: null }));
    setBusy(false);
    if ((status !== 200 || !data?.ok) && data?.error !== "not_found") {
      setCancelErr("Couldn't update your booking right now. Please try again.");
      return;
    }
    setSwapTarget(null);
    await refreshMine();
    await refreshAvail();
    setSelTopics([t.topic]);
    setSelSlots({});
    setJustFilled([]);
    goStep(3);
    show(<>You left the waitlist for {label(t.topic)} at {t.timeSlot}. Pick another time below.</>);
  };

  /* ---------- admin entry ---------- */

  const openAdmin = async () => {
    const { data } = await api<{ admin: boolean }>("/api/admin/session").catch(() => ({ data: { admin: false } }));
    if (data?.admin) router.push("/admin");
    else setShowLogin(true);
  };

  /* ---------- render pieces ---------- */

  const stepper = (
    <nav aria-label="Registration steps">
      <ol className="stepper" style={{ listStyle: "none" }}>
        {(["Details", "Topics", "Time slots", "Confirm"] as const).map((l, i) => {
          const idx = i + 1;
          const cls = idx < step ? "done" : idx === Math.floor(step) ? "active" : "";
          return (
            <li key={l} className={`step-tab ${cls}`} aria-current={cls === "active" ? "step" : undefined}>
              <span className="num" aria-hidden>
                {idx < step ? "✓" : idx}
              </span>
              <span className="lbl">{l}</span>
              {cls === "done" && <span className="sr-only"> (completed)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );

  const idBar =
    email && step > 1 && step < 5 ? (
      <div className="id-bar">
        <span>
          Registering as <strong>{name}</strong> · {email}
        </span>
        <span style={{ flex: 1 }} />
        {mine.length > 0 && step !== 1.5 && (
          <button className="link-btn" onClick={() => goStep(1.5)}>
            My bookings ({mine.length})
          </button>
        )}
        <button className="link-btn" onClick={resetFlow}>
          Not you? Switch email
        </button>
      </div>
    ) : null;

  const errorBox = submitError ? <ErrorBox>{submitError}</ErrorBox> : null;
  const heading = (text: React.ReactNode) => (
    <h1 ref={headingRef} tabIndex={-1} style={{ outline: "none" }}>
      {text}
    </h1>
  );

  let body: React.ReactNode;

  if (step === 1) {
    const nameOk = name.trim().length >= 2;
    body = (
      <>
        {stepper}
        <div className="panel">
          <h1>Register for {config.event.name}</h1>
          <div className="event-meta">
            <span className="meta-pill">
              <span className="mp-ico" aria-hidden>📅</span>
              {config.event.dateLabel}
            </span>
            <span className="meta-pill">
              <span className="mp-ico" aria-hidden>📍</span>
              {config.event.venue}
            </span>
            <span className="meta-pill">
              <span className="mp-ico" aria-hidden>🕒</span>
              {config.event.dayStart}–{config.event.dayEnd}
            </span>
          </div>
          <p className="lede">
            Pick the sessions you want and choose a time slot for each — it takes under a minute. Already registered? Enter the same
            email to see and change your bookings.
          </p>
          {errorBox}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nameOk && emailValid && !busy) void continueFromStep1();
            }}
            noValidate
          >
            <div className={`field${emailInput.length > 0 && !emailValid ? " invalid" : ""}`}>
              <label htmlFor="inE">Email address</label>
              <input
                id="inE"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder={config.registration.emailPlaceholder}
                value={emailInput}
                aria-invalid={emailInput.length > 0 && !emailValid}
                aria-describedby="inE-hint foundHint"
                onChange={(e) => onEmailInput(e.target.value)}
              />
              <div className="hint" id="inE-hint">
                {validEmail(emailNorm) && !domainOk ? emailDomainMessage() : "Please enter a valid email address."}
              </div>
              <div className="found-hint" id="foundHint" aria-live="polite" style={{ display: found?.count && found.email === emailNorm ? "block" : "none" }}>
                {found?.count ? `Welcome back — we found ${found.count} booking${found.count === 1 ? "" : "s"} for this email.` : ""}
              </div>
            </div>
            <div className={`field${name.length > 0 && !nameOk ? " invalid" : ""}`}>
              <label htmlFor="inN">Full name</label>
              <input
                id="inN"
                type="text"
                autoComplete="name"
                placeholder={config.registration.namePlaceholder}
                value={name}
                maxLength={120}
                aria-invalid={name.length > 0 && !nameOk}
                onChange={(e) => {
                  setName(e.target.value);
                  setAutoName(false);
                }}
              />
              <div className="hint">Please enter your full name.</div>
            </div>
            <div className="hp-field" aria-hidden>
              <label htmlFor="website">Website</label>
              <input id="website" ref={honeypot} tabIndex={-1} autoComplete="off" />
            </div>
            <div className="btn-row">
              <button className="btn-primary" type="submit" disabled={!nameOk || !emailValid || busy}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </form>
          {config.registration.privacyNotice && <p className="privacy-note">{config.registration.privacyNotice}</p>}
        </div>
      </>
    );
  } else if (step === 1.5) {
    const remaining = allTopics.filter((t) => !bookedByTopic[t]);
    const anyWait = mine.some((r) => r.status === "waitlist");
    const allDone = remaining.length === 0;
    body = (
      <>
        {stepper}
        {idBar}
        <div className="panel">
          {heading(mine.length ? `Welcome back, ${firstName(name)}` : "Your registration")}
          <p className="lede">
            {!mine.length
              ? "Choose the sessions you'd like to attend."
              : mine.every((r) => r.status === "waitlist")
                ? "You don't have a seat yet — you're only on the waitlist for the sessions below. Choose another time, add more sessions, or keep your waitlist place."
                : mine.some((r) => r.status === "waitlist")
                  ? "Confirmed sessions have a seat; waitlisted ones don't yet. Add more sessions, choose another time for a waitlisted one, or cancel what you no longer need."
                  : "You're already registered for the sessions below. Add more sessions or cancel the ones you no longer need."}
          </p>
          {errorBox}
          {anyWait && (
            <NoteBox kind="wait">
              You&apos;re on the <strong>waitlist</strong> for at least one session. The number shows your place in line. If a seat frees up
              you move up automatically and the organising team will confirm by email.
            </NoteBox>
          )}
          {mine.length ? (
            <>
              <div className="list-label">Your bookings</div>
              <div className="bookings">
                {mine.map((r) => (
                  <div className="b-row" key={r.id}>
                    <span className="b-topic">
                      {label(r.topic)} <StatusBadge status={r.status} position={r.waitlistPosition} />
                    </span>
                    <span className="b-time">{r.timeSlot}</span>
                    {r.status === "waitlist" && (
                      <button
                        className="btn-small"
                        aria-label={`Choose another time for ${label(r.topic)}`}
                        onClick={() => {
                          setCancelErr("");
                          setSwapTarget(r);
                        }}
                      >
                        Choose another time
                      </button>
                    )}
                    <button
                      className="btn-small danger"
                      aria-label={`Cancel ${label(r.topic)} at ${r.timeSlot}`}
                      onClick={() => {
                        setCancelErr("");
                        setCancelTarget(r);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty" style={{ border: "1px dashed var(--line)", borderRadius: 8, maxWidth: 600 }}>
              <div className="icon" aria-hidden>▦</div>
              You have no bookings at the moment.
            </div>
          )}
          {allDone && (
            <div style={{ marginTop: 16 }}>
              <NoteBox>
                You&apos;re booked for every topic, so there&apos;s nothing left to add. To switch a time slot, cancel that booking first and
                then add it again.
              </NoteBox>
            </div>
          )}
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => goStep(1)}>
              Back
            </button>
            {!allDone && (
              <button className="btn-primary" onClick={() => goStep(2)}>
                {mine.length ? "Add more sessions" : "Choose sessions"}
              </button>
            )}
          </div>
        </div>
      </>
    );
  } else if (step === 2) {
    const returning = mine.length > 0;
    const toggle = (t: string) => {
      if (selTopics.includes(t)) {
        setSelTopics(selTopics.filter((x) => x !== t));
        const s = { ...selSlots };
        delete s[t];
        setSelSlots(s);
      } else setSelTopics([...selTopics, t]);
    };
    const bookedTag = (r: MyBooking) => (
      <span className={`booked-tag${r.status === "waitlist" ? " wl" : ""}`}>
        ✓ Booked · {r.timeSlot}
        {r.status === "waitlist" ? " (waitlist)" : ""}
      </span>
    );
    const stxSel = selTopics.includes(P);
    const plenaryTimes = config.plenary.sessions.map((s) => s.time.split("-")[0]).join(" & ");
    body = (
      <>
        {stepper}
        {idBar}
        <div className="panel">
          {heading(returning ? "Add more sessions" : "Which sessions interest you?")}
          <p className="lede">
            {returning
              ? "Topics you've already booked are marked. Select any additional sessions — the system blocks time clashes with your existing bookings."
              : `Select one or more. You can attend the ${config.plenary.title} plenary, multiple product workshops${G ? " and the evening gathering" : ""} — the system blocks time clashes automatically.`}
          </p>
          {errorBox}
          <div style={{ marginBottom: 8 }}>
            {bookedByTopic[P] ? (
              <div className="ws-card stx booked">
                <h3>{config.plenary.title}</h3>
                <p>{config.plenary.description}</p>
                {bookedTag(bookedByTopic[P])}
              </div>
            ) : (
              <button
                className={`ws-card stx ${stxSel ? "selected" : ""}`}
                aria-pressed={stxSel}
                aria-label={config.plenary.title}
                aria-describedby="d-plenary"
                onClick={() => toggle(P)}
              >
                <span className={`check ${stxSel ? "on" : ""}`} aria-hidden>
                  ✓
                </span>
                <h3>{config.plenary.title}</h3>
                <p id="d-plenary">
                  {config.plenary.description} Two identical sessions available ({plenaryTimes}).
                </p>
                <span className="meta">{config.plenary.confirmedCap} seats per session</span>
              </button>
            )}
          </div>
          <div className="card-grid">
            {config.workshops.topics.map((w) => {
              if (bookedByTopic[w.key])
                return (
                  <div className="ws-card booked" key={w.key}>
                    <h3>{label(w.key)}</h3>
                    <p>{w.desc}</p>
                    {bookedTag(bookedByTopic[w.key])}
                  </div>
                );
              const sel = selTopics.includes(w.key);
              const total = config.workshops.times.filter((t) => sess[sessionId(w.key, t)]).length;
              const avail = config.workshops.times.filter((t) => {
                const s = sess[sessionId(w.key, t)];
                return s && s.state !== "full";
              }).length;
              return (
                <button
                  key={w.key}
                  className={`ws-card ${sel ? "selected" : ""}`}
                  aria-pressed={sel}
                  aria-label={label(w.key)}
                  aria-describedby={`d-${sessionId(w.key, "")}`}
                  onClick={() => toggle(w.key)}
                >
                  <span className="check" aria-hidden>
                    {sel ? "✓" : ""}
                  </span>
                  <h3>{label(w.key)}</h3>
                  <p id={`d-${sessionId(w.key, "")}`}>{w.desc}</p>
                  <span className="meta">{availability ? `${avail} of ${total} sessions with seats` : "Loading availability…"}</span>
                </button>
              );
            })}
          </div>
          {G && gSid && (
            <div style={{ marginTop: 12 }}>
              {bookedByTopic[G] ? (
                <div className="ws-card social booked">
                  <h3>{config.evening.title}</h3>
                  <p>{config.evening.registration?.cardDescription}</p>
                  {bookedTag(bookedByTopic[G])}
                </div>
              ) : sess[gSid]?.state === "full" && !selTopics.includes(G) ? (
                <div className="ws-card social booked">
                  <h3>{config.evening.title}</h3>
                  <p>{config.evening.registration?.cardDescription}</p>
                  <span className="meta">Fully booked</span>
                </div>
              ) : (
                <button
                  className={`ws-card social ${selTopics.includes(G) ? "selected" : ""}`}
                  aria-pressed={selTopics.includes(G)}
                  aria-label={config.evening.title}
                  aria-describedby="d-evening"
                  onClick={() => {
                    if (selTopics.includes(G)) return toggle(G);
                    setSelTopics([...selTopics, G]);
                    // Only one session, so pre-select it.
                    if (sess[gSid]?.state !== "full") setSelSlots({ ...selSlots, [G]: gSid });
                  }}
                >
                  <span className="check" aria-hidden>
                    {selTopics.includes(G) ? "✓" : ""}
                  </span>
                  <h3>{config.evening.title}</h3>
                  <p id="d-evening">
                    {config.evening.registration?.cardDescription} {config.evening.time.replace("-", "–")}.
                  </p>
                  <span className="meta">
                    {sess[gSid] ? `${sess[gSid].seatsLeft} of ${sess[gSid].confirmedCap} places left` : "Loading availability…"}
                  </span>
                </button>
              )}
            </div>
          )}
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => goStep(returning ? 1.5 : 1)}>
              Back
            </button>
            <button className="btn-primary" disabled={!selTopics.length} onClick={() => goStep(3)}>
              Continue to time slots{selTopics.length ? ` (${selTopics.length})` : ""}
            </button>
          </div>
        </div>
      </>
    );
  } else if (step === 3) {
    const orderedTopics = allTopics.filter((t) => selTopics.includes(t));
    const allChosen = selTopics.length > 0 && selTopics.every((t) => selSlots[t]);
    const pick = (t: string, sid: string) => {
      setSelSlots({ ...selSlots, [t]: sid });
      setJustFilled((j) => j.filter((x) => x !== sid));
    };
    const dropTopic = (t: string) => {
      const nt = selTopics.filter((x) => x !== t);
      const s = { ...selSlots };
      delete s[t];
      setSelTopics(nt);
      setSelSlots(s);
      if (!nt.length) goStep(2);
    };
    const filledNotes = justFilled
      .filter((sid) => sess[sid] && selTopics.includes(sess[sid].topic) && !selSlots[sess[sid].topic])
      .map((sid) => `${label(sess[sid].topic)} at ${sess[sid].timeSlot}`);
    body = (
      <>
        {stepper}
        {idBar}
        <div className="panel">
          {heading("Choose your time slots")}
          <p className="lede">Only your selected topics are shown. Times you&apos;re already booked for are blocked to prevent clashes.</p>
          {errorBox}
          {!submitError && filledNotes.length > 0 && (
            <ErrorBox>
              {filledNotes.join(", ")} just filled up while you were choosing. Please pick another time.
            </ErrorBox>
          )}
          {!selTopics.includes(P) && !bookedByTopic[P] && (
            <NoteBox>
              <strong>Looking for the {config.plenary.title}?</strong> It isn&apos;t in your list. To attend, go back one step and select the{" "}
              {config.plenary.title} card, then pick one of its two sessions here.
            </NoteBox>
          )}
          {orderedTopics.map((t) => {
            const chosen = selSlots[t];
            if (t === G && gSid) {
              const s = sess[gSid];
              const sel = chosen === gSid;
              const dis = !s || (s.state === "full" && !sel);
              return (
                <div className="slot-group" key={t} role="group" aria-labelledby={`g-${t}`}>
                  <h3 id={`g-${t}`}>{config.evening.title}</h3>
                  <div className="sub">One session for everyone. No waitlist — once all places are taken, registration closes.</div>
                  <div className="slot-list">
                    <button
                      className={`slot-btn ${sel ? "selected" : ""}${justFilled.includes(gSid) ? " just-filled" : ""}`}
                      disabled={dis}
                      aria-pressed={sel}
                      onClick={() => pick(t, gSid)}
                    >
                      {config.evening.time} <SeatPill s={s} justFilled={justFilled.includes(gSid)} />
                    </button>
                  </div>
                  {s?.state === "full" && !sel && (
                    <div className="sub" style={{ color: "var(--red)", marginTop: 8 }}>
                      The gathering is fully booked.{" "}
                      <button className="link-btn" onClick={() => dropTopic(t)}>
                        Remove it from this registration
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            if (t === P) {
              return (
                <div className="slot-group" key={t} role="group" aria-labelledby={`g-${t}`}>
                  <h3 id={`g-${t}`}>{config.plenary.title}</h3>
                  <div className="sub">Choose exactly one of the two identical sessions — you can&apos;t attend both.</div>
                  <div className="slot-list">
                    {config.plenary.sessions.map((ps) => {
                      const sid = sessionId(P, ps.time);
                      const s = sess[sid];
                      const own = mine.find((r) => r.timeSlot === ps.time);
                      const sel = chosen === sid;
                      const dis = !s || (s.state === "full" && !sel) || !!own;
                      return (
                        <button
                          key={sid}
                          className={`slot-btn ${sel ? "selected" : ""}${s?.state === "waitlist" && !dis ? " waitlist" : ""}${justFilled.includes(sid) ? " just-filled" : ""}`}
                          disabled={dis}
                          aria-pressed={sel}
                          onClick={() => pick(t, sid)}
                        >
                          {ps.time}{" "}
                          {own ? <span className="seat-pill full">booked: {label(own.topic)}</span> : <SeatPill s={s} justFilled={justFilled.includes(sid)} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            const otherSel = Object.entries(selSlots)
              .filter(([k]) => k !== t)
              .map(([, id]) => timeOf(id));
            let usable = 0;
            const btns = config.workshops.times.map((time) => {
              const sid = sessionId(t, time);
              const s = sess[sid];
              if (!s) return null;
              const own = mine.find((r) => r.timeSlot === time);
              const clash = otherSel.includes(time);
              const dis = s.state === "full" || clash || !!own;
              if (!dis) usable++;
              const sel = chosen === sid;
              const tag = own ? (
                <span className="seat-pill full">booked: {label(own.topic)}</span>
              ) : clash ? (
                <span className="seat-pill full">clash</span>
              ) : (
                <SeatPill s={s} justFilled={justFilled.includes(sid)} />
              );
              return (
                <button
                  key={sid}
                  className={`slot-btn ${sel ? "selected" : ""}${s.state === "waitlist" && !dis ? " waitlist" : ""}${justFilled.includes(sid) ? " just-filled" : ""}`}
                  disabled={dis}
                  aria-pressed={sel}
                  onClick={() => pick(t, sid)}
                >
                  {time} {tag}
                </button>
              );
            });
            return (
              <div className="slot-group" key={t} role="group" aria-labelledby={`g-${t}`}>
                <h3 id={`g-${t}`}>{label(t)}</h3>
                {usable === 0 && availability ? (
                  <div className="sub" style={{ color: "var(--red)" }}>
                    No time slot fits your schedule for this topic.{" "}
                    <button className="link-btn" onClick={() => dropTopic(t)}>
                      Remove {label(t)} from this registration
                    </button>
                  </div>
                ) : (
                  <div className="sub">Pick exactly one session.</div>
                )}
                <div className="slot-list">{btns}</div>
              </div>
            );
          })}
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => goStep(2)}>
              Back
            </button>
            <button className="btn-primary" disabled={!allChosen} onClick={() => goStep(4)}>
              Review registration
            </button>
          </div>
        </div>
      </>
    );
  } else if (step === 4) {
    const items = selTopics
      .map((t) => ({ t, s: sess[selSlots[t]] }))
      .filter((x) => x.s)
      .sort((a, b) => a.s.timeSlot.localeCompare(b.s.timeSlot));
    const anyWait = items.some((x) => x.s.state !== "open");
    body = (
      <>
        {stepper}
        {idBar}
        <div className="panel">
          {heading("Confirm your registration")}
          <p className="lede">Please review. Seats are reserved only after you confirm.</p>
          {errorBox}
          {anyWait && (
            <NoteBox kind="wait">
              One or more of your sessions is full, so you&apos;ll join its <strong>waitlist</strong>. You&apos;ll keep your spot in line and
              move up automatically if a seat frees up — the organising team will confirm by email.
            </NoteBox>
          )}
          <div className="summary-box">
            <div className="row">
              <span className="k">Name</span>
              <span className="v">{name}</span>
            </div>
            <div className="row">
              <span className="k">Email</span>
              <span className="v">{email}</span>
            </div>
            <div className="summary-ws">
              <div className="k">{mine.length ? "Adding now" : "Selected sessions"}</div>
              {items.map(({ t, s }) => (
                <div className="item" key={t}>
                  <span>
                    {label(t)} {s.state !== "open" && <span className="status-badge wait">Waitlist</span>}
                  </span>
                  <span>{s.timeSlot}</span>
                </div>
              ))}
              {mine.length > 0 && (
                <>
                  <div className="k" style={{ marginTop: 8 }}>
                    Already booked
                  </div>
                  {mine.map((r) => (
                    <div className="item existing" key={r.id}>
                      <span>
                        {label(r.topic)}{" "}
                        <span className={`status-badge ${r.status === "waitlist" ? "wait" : "conf"}`} style={{ opacity: 0.75 }}>
                          Already booked
                        </span>
                      </span>
                      <span>{r.timeSlot}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => goStep(3)} disabled={busy}>
              Back
            </button>
            <button className="btn-primary" onClick={submit} disabled={busy || items.length !== selTopics.length}>
              {busy ? "Saving…" : "Confirm registration"}
            </button>
          </div>
        </div>
      </>
    );
  } else {
    const newOnes = mine.filter((r) => lastNewIds.includes(r.id));
    const newWait = newOnes.filter((r) => r.status === "waitlist");
    const newConfirmed = newOnes.length - newWait.length;
    const reminder = !G || bookedByTopic[G] ? config.evening.successReminder : config.evening.successReminderNotBooked;
    body = (
      <div className="success">
        {newWait.length ? (
          <>
            <div className="tick wait" aria-hidden>
              !
            </div>
            {heading(
              newConfirmed
                ? `Registered for ${newConfirmed} of ${newOnes.length} sessions, ${firstName(name)}`
                : "You're on the waitlist — not registered",
            )}
            <div className="alert-wait" role="alert">
              <strong>
                {newWait.length === 1 ? "This session has no seat for you:" : "These sessions have no seat for you:"}
              </strong>
              <ul>
                {newWait.map((r) => (
                  <li key={r.id}>
                    <strong>
                      {label(r.topic)} · {r.timeSlot}
                    </strong>{" "}
                    — not registered, you&apos;re <strong>#{r.waitlistPosition ?? "?"} on the waitlist</strong>
                    {predictedOpen.includes(r.sessionId) && <> (it filled up while you were registering)</>}
                  </li>
                ))}
              </ul>
              Your registration for {newWait.length === 1 ? "this session" : "these sessions"} did <strong>not</strong> go through — you were put on
              the waitlist instead. You only get a seat if someone cancels; you&apos;ll then move up automatically and the organising team will email
              you. If you&apos;d rather attend at another time, adjust your sessions now.
            </div>
          </>
        ) : (
          <>
            <div className="tick" aria-hidden>
              ✓
            </div>
            {heading(`You're registered, ${firstName(name)}`)}
          </>
        )}
        {newConfirmed > 0 && (
          <p>
            See you on {config.event.shortDateLabel}. {reminder}
          </p>
        )}
        <p className="email-line">
          Registered with <strong>{email}</strong>
        </p>
        <div className="list-label" style={{ textAlign: "left", marginTop: 14 }}>
          All your bookings
        </div>
        <div className="booked" style={{ marginTop: 0 }}>
          {mine.map((r) => (
            <div className="item" key={r.id}>
              <span>
                {label(r.topic)} <StatusBadge status={r.status} position={r.waitlistPosition} />
                {lastNewIds.includes(r.id) && <span className="status-badge promo">New</span>}
              </span>
              <span>{r.timeSlot}</span>
            </div>
          ))}
        </div>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <button className="btn-primary" onClick={() => goStep(1.5)}>
            {newWait.length ? "Adjust my sessions" : "Manage my bookings"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header config={config} isAdminView={false} onAdmin={openAdmin} />
      {!live && (
        <div className="storage-banner" role="status">
          <span className="live-dot stale" />
          Live seat counts are temporarily unavailable. Retrying… Your booking is always checked against the latest data when you confirm.
        </div>
      )}
      <div className="shell">
        <main id="mainCol">{body}</main>
        <Timetable config={config} selectedTopics={selTopics} booked={email ? mine : []} />
      </div>
      {cancelTarget && (
        <Modal onClose={() => setCancelTarget(null)} label="Cancel this booking?">
          <h2>Cancel this booking?</h2>
          <p>
            {label(cancelTarget.topic)} at {cancelTarget.timeSlot}.{" "}
            {cancelTarget.status === "waitlist"
              ? "You'll leave the waitlist for this session."
              : "Your seat will go to the next person on the waitlist."}
          </p>
          <div className="err" role="alert">
            {cancelErr}
          </div>
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => setCancelTarget(null)}>
              Keep it
            </button>
            <button className="btn-danger" onClick={doCancel} disabled={busy}>
              Cancel booking
            </button>
          </div>
        </Modal>
      )}
      {swapTarget && (
        <Modal onClose={() => setSwapTarget(null)} label="Choose another time?">
          <h2>Choose another time?</h2>
          {alternativesFor(swapTarget).length ? (
            <p>
              You&apos;ll leave the waitlist for {label(swapTarget.topic)} at {swapTarget.timeSlot} (you&apos;re #{swapTarget.waitlistPosition ?? "?"}).
              Right now {alternativesFor(swapTarget).length} other time{alternativesFor(swapTarget).length === 1 ? "" : "s"} can still be booked —
              you&apos;ll pick one on the next screen.
            </p>
          ) : (
            <p>
              No other time for {label(swapTarget.topic)} can be booked right now (full or clashing with your other sessions). Keep your waitlist
              place — you&apos;ll move up automatically if someone cancels.
            </p>
          )}
          <div className="err" role="alert">
            {cancelErr}
          </div>
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => setSwapTarget(null)}>
              Keep my waitlist place
            </button>
            {alternativesFor(swapTarget).length > 0 && (
              <button className="btn-primary" onClick={doSwap} disabled={busy}>
                Leave waitlist and choose
              </button>
            )}
          </div>
        </Modal>
      )}
      {showLogin && (
        <AdminLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            router.push("/admin");
          }}
        />
      )}
      <Toast toast={toast} />
    </>
  );
}
