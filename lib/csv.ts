import { topicLabel, type EventConfig } from "./config";
import type { AdminBooking } from "./types";

/** Neutralise spreadsheet formulas (= + - @ tab CR) and quote every cell. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** UTF-8 with BOM so umlauts open correctly in Excel. */
export function toCsv(rows: unknown[][]): string {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Timestamps are exported in UTC (ISO 8601, "Z") so they are unambiguous whatever the DB session timezone. */
const utc = (iso: string | null) => (iso ? new Date(iso).toISOString() : "");

const byTime = (a: AdminBooking, b: AdminBooking) => a.timeSlot.localeCompare(b.timeSlot) || a.topic.localeCompare(b.topic);

/** One row per person — for sending invitations manually. */
export function peopleCsv(cfg: EventConfig, regs: AdminBooking[]): string {
  const people = new Map<string, { name: string; email: string; latest: string; regs: AdminBooking[] }>();
  for (const r of regs) {
    const p = people.get(r.email) ?? { name: r.name, email: r.email, latest: "", regs: [] };
    p.regs.push(r);
    if (r.createdAt > p.latest) {
      p.latest = r.createdAt;
      p.name = r.name;
    }
    people.set(r.email, p);
  }
  const fmt = (r: AdminBooking) => `${topicLabel(cfg, r.topic)} (${r.timeSlot})`;
  const rows: unknown[][] = [["Name", "Email", "Sessions booked (confirmed)", "Waitlisted sessions", "Number of sessions"]];
  [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((p) => {
      const list = p.regs.sort(byTime);
      rows.push([
        p.name,
        p.email,
        list.filter((r) => r.status === "confirmed").map(fmt).join("; "),
        list.filter((r) => r.status === "waitlist").map(fmt).join("; "),
        list.length,
      ]);
    });
  return toCsv(rows);
}

/** One row per booking. */
export function detailCsv(cfg: EventConfig, regs: AdminBooking[]): string {
  const rows: unknown[][] = [
    ["Name", "Email", "Session", "Time", "Status", "Waitlist position", "Registered at", "Added by", "Promoted at", "Seat guaranteed by admin"],
  ];
  [...regs]
    .sort((a, b) => a.name.localeCompare(b.name) || byTime(a, b))
    .forEach((r) =>
      rows.push([
        r.name,
        r.email,
        topicLabel(cfg, r.topic),
        r.timeSlot,
        r.status,
        r.waitlistPosition ?? "",
        utc(r.createdAt),
        r.source === "admin" ? "admin" : "self",
        utc(r.promotedAt),
        r.forced ? "yes" : "",
      ]),
    );
  return toCsv(rows);
}
