import defaultConfigJson from "@/config/event.default.json";

export type TopicDef = { key: string; desc: string };

export type EventConfig = {
  event: {
    name: string;
    tagline: string;
    date: string;
    dateLabel: string;
    shortDateLabel: string;
    venue: string;
    dayStart: string;
    dayEnd: string;
    timezone: string;
  };
  branding: {
    primaryLogo: string;
    primaryLogoAlt: string;
    secondaryLogo: string;
    secondaryLogoAlt: string;
    colors: Partial<Record<"orange" | "orangeSoft" | "orangeDark" | "accent" | "accentSoft", string>>;
  };
  plenary: {
    topic: string;
    title: string;
    description: string;
    timetableNote: string;
    confirmedCap: number;
    waitlistCap: number;
    sessions: { time: string; label: string }[];
  };
  workshops: {
    confirmedCap: number;
    waitlistCap: number;
    topics: TopicDef[];
    times: string[];
    grid: string[][];
  };
  evening: {
    time: string;
    title: string;
    description: string;
    successReminder: string;
    successReminderNotBooked: string;
    /** When enabled, the gathering is a bookable session (no waitlist by default). */
    registration?: {
      enabled: boolean;
      topic: string;
      cardDescription: string;
      confirmedCap: number;
      waitlistCap: number;
    };
  };
  registration: {
    allowedEmailDomains: string[];
    emailPlaceholder: string;
    namePlaceholder: string;
    privacyNotice: string;
  };
  capacityOverrides: Record<string, { confirmedCap?: number; waitlistCap?: number }>;
};

export type SessionDef = {
  id: string;
  topic: string;
  kind: "plenary" | "workshop" | "social";
  timeSlot: string;
  label: string | null;
  room: number | null;
  sortOrder: number;
  confirmedCap: number;
  waitlistCap: number;
};

export const DEFAULT_CONFIG = defaultConfigJson as EventConfig;

/** Stable session id, identical to the prototype: "cooling_13001330", "stx_09301030". */
export function sessionId(topic: string, time: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]/g, "") + "_" + time.replace(/[:-]/g, "");
}

/** Expands the config (plenary sessions + rotation grid) into the flat session list stored in the DB. */
export function buildSessions(cfg: EventConfig): SessionDef[] {
  const out: SessionDef[] = [];
  let order = 0;
  const cap = (id: string, c: number, w: number) => ({
    confirmedCap: cfg.capacityOverrides?.[id]?.confirmedCap ?? c,
    waitlistCap: cfg.capacityOverrides?.[id]?.waitlistCap ?? w,
  });
  for (const s of cfg.plenary.sessions) {
    const id = sessionId(cfg.plenary.topic, s.time);
    out.push({
      id,
      topic: cfg.plenary.topic,
      kind: "plenary",
      timeSlot: s.time,
      label: s.label,
      room: null,
      sortOrder: order++,
      ...cap(id, cfg.plenary.confirmedCap, cfg.plenary.waitlistCap),
    });
  }
  // Order workshops by topic list, then time, so the admin capacity table groups by topic.
  for (const t of cfg.workshops.topics) {
    cfg.workshops.times.forEach((time, ri) => {
      const room = cfg.workshops.grid[ri]?.indexOf(t.key);
      if (room === undefined || room < 0) return;
      const id = sessionId(t.key, time);
      out.push({
        id,
        topic: t.key,
        kind: "workshop",
        timeSlot: time,
        label: null,
        room: room + 1,
        sortOrder: order++,
        ...cap(id, cfg.workshops.confirmedCap, cfg.workshops.waitlistCap),
      });
    });
  }
  const reg = cfg.evening.registration;
  if (reg?.enabled) {
    const id = sessionId(reg.topic, cfg.evening.time);
    out.push({
      id,
      topic: reg.topic,
      kind: "social",
      timeSlot: cfg.evening.time,
      label: cfg.evening.title,
      room: null,
      sortOrder: order++,
      ...cap(id, reg.confirmedCap, reg.waitlistCap),
    });
  }
  return out;
}

/** The bookable evening gathering's topic key, or null when it needs no registration. */
export function eveningTopic(cfg: EventConfig): string | null {
  return cfg.evening.registration?.enabled ? cfg.evening.registration.topic : null;
}

const isStr = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isCap = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10000;
const TIME_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

/** Validates an admin-supplied config. Returns a list of problems (empty when valid). */
export function validateConfig(raw: unknown): string[] {
  const errs: string[] = [];
  const c = raw as EventConfig;
  if (!c || typeof c !== "object") return ["Config must be a JSON object."];
  for (const k of ["name", "tagline", "dateLabel", "venue", "dayStart", "dayEnd", "timezone"] as const) {
    if (!isStr(c.event?.[k])) errs.push(`event.${k} is required.`);
  }
  if (c.event?.timezone) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: c.event.timezone });
    } catch {
      errs.push(`event.timezone "${c.event.timezone}" is not a valid IANA timezone.`);
    }
  }
  if (!isStr(c.plenary?.topic)) errs.push("plenary.topic is required.");
  if (!isStr(c.plenary?.title)) errs.push("plenary.title is required.");
  if (!isCap(c.plenary?.confirmedCap) || !isCap(c.plenary?.waitlistCap)) errs.push("plenary capacities must be whole numbers ≥ 0.");
  if (!Array.isArray(c.plenary?.sessions)) errs.push("plenary.sessions must be a list.");
  else
    c.plenary.sessions.forEach((s, i) => {
      if (!TIME_RE.test(s?.time ?? "")) errs.push(`plenary.sessions[${i}].time must look like 09:30-10:30.`);
    });
  const topics = c.workshops?.topics;
  if (!Array.isArray(topics) || !topics.length) errs.push("workshops.topics must be a non-empty list.");
  const keys = new Set<string>();
  topics?.forEach((t, i) => {
    if (!isStr(t?.key)) errs.push(`workshops.topics[${i}].key is required.`);
    if (keys.has(t?.key)) errs.push(`Duplicate topic "${t?.key}".`);
    keys.add(t?.key);
  });
  if (c.plenary?.topic && keys.has(c.plenary.topic)) errs.push("The plenary topic must differ from all workshop topics.");
  if (!isCap(c.workshops?.confirmedCap) || !isCap(c.workshops?.waitlistCap)) errs.push("workshop capacities must be whole numbers ≥ 0.");
  const times = c.workshops?.times;
  if (!Array.isArray(times)) errs.push("workshops.times must be a list.");
  times?.forEach((t, i) => {
    if (!TIME_RE.test(t ?? "")) errs.push(`workshops.times[${i}] must look like 13:00-13:30.`);
  });
  const reg = c.evening?.registration;
  if (reg?.enabled) {
    if (!isStr(reg.topic)) errs.push("evening.registration.topic is required.");
    if (keys.has(reg.topic) || reg.topic === c.plenary?.topic) errs.push("evening.registration.topic must differ from all other topics.");
    if (!isCap(reg.confirmedCap) || !isCap(reg.waitlistCap)) errs.push("evening registration capacities must be whole numbers ≥ 0.");
    if (!TIME_RE.test(c.evening?.time ?? "")) errs.push("evening.time must look like 17:30-20:00.");
  }
  const allTimes = [
    ...(times ?? []),
    ...(c.plenary?.sessions ?? []).map((s) => s.time),
    ...(reg?.enabled ? [c.evening.time] : []),
  ];
  if (new Set(allTimes).size !== allTimes.length) errs.push("Every session time (plenary and workshop rows) must be unique.");
  if (!Array.isArray(c.workshops?.grid) || c.workshops.grid.length !== (times?.length ?? -1))
    errs.push("workshops.grid needs exactly one row per time.");
  else
    c.workshops.grid.forEach((row, ri) => {
      if (!Array.isArray(row)) return errs.push(`workshops.grid[${ri}] must be a list.`);
      row.forEach((cell) => {
        if (!keys.has(cell)) errs.push(`workshops.grid[${ri}] contains unknown topic "${cell}".`);
      });
      if (new Set(row).size !== row.length) errs.push(`workshops.grid[${ri}] lists a topic twice.`);
    });
  if (!Array.isArray(c.registration?.allowedEmailDomains)) errs.push("registration.allowedEmailDomains must be a list (can be empty).");
  if (c.capacityOverrides && typeof c.capacityOverrides !== "object") errs.push("capacityOverrides must be an object.");
  else
    Object.entries(c.capacityOverrides ?? {}).forEach(([id, o]) => {
      if (o.confirmedCap !== undefined && !isCap(o.confirmedCap)) errs.push(`capacityOverrides.${id}.confirmedCap is invalid.`);
      if (o.waitlistCap !== undefined && !isCap(o.waitlistCap)) errs.push(`capacityOverrides.${id}.waitlistCap is invalid.`);
    });
  return errs;
}

export function topicLabel(cfg: EventConfig, topic: string): string {
  if (topic === cfg.plenary.topic) return cfg.plenary.title;
  if (topic === eveningTopic(cfg)) return cfg.evening.title;
  return topic;
}

export function emailDomainAllowed(cfg: EventConfig, email: string): boolean {
  const domains = (cfg.registration.allowedEmailDomains ?? []).map((d) => d.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  if (!domains.length) return true;
  return domains.includes(email.split("@")[1] ?? "");
}
