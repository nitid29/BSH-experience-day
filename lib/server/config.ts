import "server-only";
import { cache } from "react";
import { DEFAULT_CONFIG, buildSessions, type EventConfig } from "@/lib/config";
import { rpc } from "./db";

/**
 * The live event configuration lives in the database (editable in Admin → Settings).
 * On a fresh database it is seeded from config/event.default.json.
 */
export const getConfig = cache(async (): Promise<EventConfig> => {
  const stored = await rpc<EventConfig | null>("get_event_config");
  if (stored) return withDefaults(stored);
  await rpc("admin_apply_config", { p_config: DEFAULT_CONFIG, p_sessions: buildSessions(DEFAULT_CONFIG) });
  return DEFAULT_CONFIG;
});

/** Fill in keys that older stored configs may not have yet. */
function withDefaults(c: EventConfig): EventConfig {
  return {
    ...DEFAULT_CONFIG,
    ...c,
    event: { ...DEFAULT_CONFIG.event, ...c.event },
    branding: { ...DEFAULT_CONFIG.branding, ...c.branding, colors: { ...DEFAULT_CONFIG.branding.colors, ...c.branding?.colors } },
    evening: { ...DEFAULT_CONFIG.evening, ...c.evening },
    registration: { ...DEFAULT_CONFIG.registration, ...c.registration },
    capacityOverrides: c.capacityOverrides ?? {},
  };
}
