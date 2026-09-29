"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { EventConfig } from "@/lib/config";
import type { SessionAvail } from "@/lib/types";

/* eslint-disable @next/next/no-img-element */

export function Header({
  config,
  participants,
  isAdminView,
  onAdmin,
  onBack,
}: {
  config: EventConfig;
  participants: number | null;
  isAdminView: boolean;
  onAdmin?: () => void;
  onBack?: () => void;
}) {
  const b = config.branding;
  return (
    <header>
      <div className="header-inner">
        <div className="brandmark">
          <Link href="/" aria-label={`${config.event.name} — registration`}>
            <img src={b.primaryLogo} alt={b.primaryLogoAlt} />
          </Link>
        </div>
        <div>
          <div className="brand-title">{config.event.name}</div>
          <div className="brand-sub">{config.event.tagline}</div>
        </div>
        <div className="header-spacer" />
        <div className="header-right">
          <span className="reg-count" aria-live="polite">
            {participants === null ? "…" : `${participants} participant${participants === 1 ? "" : "s"}`}
          </span>
          {isAdminView ? (
            <button className="btn-ghost" onClick={onBack}>
              ← Registration
            </button>
          ) : (
            <button className="btn-ghost" onClick={onAdmin}>
              Admin
            </button>
          )}
          <span className="bsh-divider" />
          <img className="bsh-logo" src={b.secondaryLogo} alt={b.secondaryLogoAlt} />
        </div>
      </div>
    </header>
  );
}

export function SeatPill({ s, justFilled }: { s: SessionAvail | undefined; justFilled?: boolean }) {
  if (!s) return <span className="seat-pill full">—</span>;
  if (s.state === "full") return <span className="seat-pill full">{justFilled ? "Just filled up" : "Full"}</span>;
  if (s.state === "waitlist") return <span className="seat-pill wait">Waitlist · {s.waitlistLeft} left</span>;
  const rem = s.seatsLeft;
  const pct = s.confirmedCap ? rem / s.confirmedCap : 0;
  const cls = pct > 0.5 ? "green" : pct > 0.2 ? "yellow" : "red";
  return (
    <span className={`seat-pill ${cls}`}>
      {rem} seat{rem === 1 ? "" : "s"} left
    </span>
  );
}

export function StatusBadge({ status, position }: { status: "confirmed" | "waitlist"; position?: number | null }) {
  if (status === "waitlist") return <span className="status-badge wait">Waitlist{position ? ` #${position}` : ""}</span>;
  return <span className="status-badge conf">Confirmed</span>;
}

export function NoteBox({ kind, children }: { kind?: "wait"; children: React.ReactNode }) {
  return (
    <div className={`note-box${kind ? " " + kind : ""}`} role="note">
      <span className="note-icon" aria-hidden>
        i
      </span>
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="error-box" role="alert">
      <span aria-hidden>⚠</span>
      <div>{children}</div>
    </div>
  );
}

export function Modal({
  children,
  onClose,
  wide,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,button.btn-primary,button.btn-danger");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("button:not(:disabled),input,select,textarea,a[href]")];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        {children}
      </div>
    </div>
  );
}

export function Toast({ toast }: { toast: { html: React.ReactNode; key: number } | null }) {
  if (!toast) return null;
  return (
    <div className="toast" key={toast.key} role="status" aria-live="polite">
      {toast.html}
    </div>
  );
}

export function Timetable({
  config,
  selectedTopics,
  booked,
}: {
  config: EventConfig;
  selectedTopics: string[];
  booked: { topic: string; timeSlot: string }[];
}) {
  const w = config.workshops;
  const cols = Math.max(...w.grid.map((r) => r.length), 0);
  const legend: React.ReactNode[] = [];
  if (selectedTopics.length)
    legend.push(
      <span key="sel">
        <span className="dot" />
        Selected topics
      </span>,
    );
  if (booked.some((r) => r.topic !== config.plenary.topic))
    legend.push(
      <span key="bk">
        <span className="dot bk" />
        Your bookings
      </span>,
    );
  const plenaryTimes = config.plenary.sessions.map((s) => s.time.replace("-", "–")).join(" & ");
  return (
    <aside className="timetable-panel" aria-label="Full workshop timetable">
      <div className="tt-head">
        <h2>Session timetable · {config.event.dateLabel}</h2>
        <p>
          Six parallel rooms rotate through all topics. {w.confirmedCap} seats each — a waitlist opens once a session is full.
        </p>
      </div>
      <div className="tt-info plenary">
        <strong>
          {plenaryTimes} · {config.plenary.title}
        </strong>
        {config.plenary.timetableNote}
      </div>
      <div className="tt-table-wrap">
        <table className="tt">
          <colgroup>
            <col className="c-time" />
            {Array.from({ length: cols }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Time</th>
              {Array.from({ length: cols }, (_, i) => (
                <th scope="col" key={i}>
                  Slot {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {w.grid.map((row, ri) => (
              <tr key={ri}>
                <td className="time">{w.times[ri]}</td>
                {row.map((topic, ci) => {
                  const isBooked = booked.some((r) => r.topic === topic && r.timeSlot === w.times[ri]);
                  const cls = isBooked ? "bk" : selectedTopics.includes(topic) ? "hl" : undefined;
                  return (
                    <td key={ci} className={cls}>
                      {topic}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {legend.length > 0 && (
        <div className="tt-legend" style={{ display: "flex", gap: 14 }}>
          {legend}
        </div>
      )}
      <div className="tt-info social" style={{ marginBottom: 14 }}>
        <strong>
          {config.evening.time.replace("-", "–")} · {config.evening.title}
        </strong>
        {config.evening.description}
      </div>
    </aside>
  );
}

export function AdminLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const err = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const go = async () => {
    const pw = inp.current?.value ?? "";
    if (!pw) return;
    btn.current!.disabled = true;
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    btn.current!.disabled = false;
    if (res.ok && data.ok) return onSuccess();
    if (err.current) err.current.textContent = data.message || data.error || "Incorrect password. Try again.";
    if (inp.current) {
      inp.current.value = "";
      inp.current.focus();
    }
  };
  return (
    <Modal onClose={onClose} label="Admin access">
      <h2>Admin access</h2>
      <p>Enter the admin password to continue.</p>
      <input
        ref={inp}
        type="password"
        aria-label="Admin password"
        autoComplete="current-password"
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <div className="err" ref={err} role="alert" />
      <div className="btn-row" style={{ justifyContent: "center" }}>
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" ref={btn} onClick={go}>
          Unlock
        </button>
      </div>
    </Modal>
  );
}
