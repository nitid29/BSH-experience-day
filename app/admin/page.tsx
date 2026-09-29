import AdminApp from "@/components/AdminApp";
import SetupError from "@/components/SetupError";
import { getConfig } from "@/lib/server/config";
import { realtimeInfo } from "@/lib/server/page";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin — REU Experience Day" };

export default async function AdminPage() {
  let config;
  try {
    config = await getConfig();
  } catch (e) {
    return <SetupError error={e} />;
  }
  return <AdminApp initialConfig={config} realtime={realtimeInfo()} />;
}
