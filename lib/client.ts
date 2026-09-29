"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Availability, SessionAvail } from "./types";

export type RealtimeInfo = { url: string; anonKey: string } | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes vary per endpoint
export async function api<T = any>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, data };
}

export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const normEmail = (e: string) => String(e || "").trim().toLowerCase();
export const firstName = (n: string) => String(n || "").trim().split(/\s+/)[0] || "there";

export function indexSessions(av: Availability | null): Record<string, SessionAvail> {
  const m: Record<string, SessionAvail> = {};
  av?.sessions.forEach((s) => (m[s.id] = s));
  return m;
}

const POLL_MS = 12_000;

/**
 * Live availability from the database (PRD 8.15). Fetches on mount and whenever `refetchKey` changes,
 * re-fetches when the database signals a change via Supabase Realtime, and polls every 12 s as a
 * fallback (and as the only mechanism in local mode). Numbers update in place.
 */
export function useAvailability(realtime: RealtimeInfo, active: boolean, refetchKey: unknown, onChange?: () => void) {
  const [data, setData] = useState<Availability | null>(null);
  const [live, setLive] = useState(true);
  const lastVersion = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const refresh = useCallback(async () => {
    try {
      const { status, data } = await api<Availability>("/api/availability");
      if (status !== 200 || !data?.sessions) throw new Error("bad response");
      setData(data);
      setLive(true);
      if (lastVersion.current !== null && lastVersion.current !== data.version) onChangeRef.current?.();
      lastVersion.current = data.version;
      return data;
    } catch {
      setLive(false);
      return null;
    }
  }, []);

  useEffect(() => {
    // Fetch from the server (an external system); state is set after the response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, refetchKey]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (!active || !realtime) return;
    let cleanup = () => {};
    let cancelled = false;
    void import("@supabase/supabase-js").then(({ createClient }) => {
      if (cancelled) return;
      const sb = createClient(realtime.url, realtime.anonKey, { auth: { persistSession: false } });
      const ch = sb
        .channel("reu-availability")
        .on("postgres_changes", { event: "*", schema: "public", table: "availability_version" }, () => void refresh())
        .subscribe();
      cleanup = () => void sb.removeChannel(ch);
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active, realtime, refresh]);

  return { availability: data, live, refresh };
}

export function useToast() {
  const [toast, setToast] = useState<{ html: React.ReactNode; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((html: React.ReactNode, ms = 5000) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ html, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);
  return { toast, show };
}
