import { rpc } from "@/lib/server/db";
import { json, serverError } from "@/lib/server/http";
import type { Availability } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Live seat counts for every session (counts only — never names or emails). */
export async function GET() {
  try {
    return json(await rpc<Availability>("get_availability"));
  } catch (e) {
    return serverError(e);
  }
}
