import type { Metadata } from "next";
import { getConfig } from "@/lib/server/config";
import { DEFAULT_CONFIG } from "@/lib/config";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getConfig().catch(() => DEFAULT_CONFIG);
  return {
    title: `${cfg.event.name} — Registration`,
    description: `${cfg.event.tagline} Register for ${cfg.event.name}, ${cfg.event.dateLabel} at ${cfg.event.venue}.`,
    robots: { index: false, follow: false },
  };
}

const VAR: Record<string, string> = {
  orange: "--orange",
  orangeSoft: "--orange-soft",
  orangeDark: "--orange-dark",
  accent: "--accent",
  accentSoft: "--accent-soft",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = await getConfig().catch(() => DEFAULT_CONFIG);
  const hex = /^#[0-9a-fA-F]{3,8}$/;
  const vars = Object.entries(cfg.branding.colors ?? {})
    .filter(([k, v]) => VAR[k] && typeof v === "string" && hex.test(v))
    .map(([k, v]) => `${VAR[k]}:${v};`)
    .join("");
  return (
    <html lang="en">
      <head>{vars && <style>{`:root{${vars}}`}</style>}</head>
      <body>{children}</body>
    </html>
  );
}
