import { rpc } from "@/lib/server/db";
import { json, serverError } from "@/lib/server/http";
import type { Availability } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Live seat counts for every session (counts only — never names or emails). */
export async function GET() {
  try {
    // The participant total is for organisers only (shown in the admin dashboard).
    const { participants: _hidden, ...pub } = await rpc<Availability>("get_availability");
    void _hidden;
    return json(pub);
  } catch (e) {
    return serverError(e);
  }
}
