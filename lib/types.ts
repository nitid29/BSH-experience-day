export type SessionState = "open" | "waitlist" | "full";

export type SessionAvail = {
  id: string;
  topic: string;
  kind: "plenary" | "workshop" | "social";
  timeSlot: string;
  label: string | null;
  room: number | null;
  sortOrder: number;
  confirmedCap: number;
  waitlistCap: number;
  confirmedCount: number;
  waitlistCount: number;
  forcedCount: number;
  seatsLeft: number;
  waitlistLeft: number;
  state: SessionState;
};

/** `participants` is only present in the admin data, never in the public feed. */
export type Availability = { version: number; participants?: number; sessions: SessionAvail[] };

export type MyBooking = {
  id: string;
  topic: string;
  sessionId: string;
  timeSlot: string;
  status: "confirmed" | "waitlist";
  waitlistPosition: number | null;
};

export type AdminBooking = MyBooking & {
  name: string;
  email: string;
  queuedAt: string;
  forced: boolean;
  source: "self" | "admin";
  promotedAt: string | null;
  movedAt: string | null;
  createdAt: string;
};

export type BookOutcome = {
  sessionId: string;
  topic: string | null;
  timeSlot: string | null;
  result: "ok" | "rejected" | "confirmed" | "waitlist";
  reason?: string | null;
  id?: string;
  waitlistPosition?: number | null;
};

export type BookResponse =
  | { ok: true; outcomes: BookOutcome[] }
  | { ok: false; error: string; message?: string; outcomes?: BookOutcome[] };

export type Promoted = { id: string; name: string; email: string; sessionId: string };

export type AuditEntry = {
  id: number;
  at: string;
  action: string;
  actor: string;
  registration_id: string | null;
  email: string | null;
  name: string | null;
  session_id: string | null;
  detail: Record<string, unknown>;
};
