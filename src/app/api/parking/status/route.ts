import { getBrokerUrl, getPlatform, isPlatformConnected } from "@/lib/parking/mqtt-platform";
import { listSimulators } from "@/lib/parking/simulator";

// 平台 MQTT 連線與模擬設備狀態
export async function GET() {
  let broker = "";
  let error: string | null = null;
  try {
    broker = getBrokerUrl();
    getPlatform();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return Response.json({
    broker,
    platformConnected: isPlatformConnected(),
    error,
    simulators: listSimulators(),
  });
}
