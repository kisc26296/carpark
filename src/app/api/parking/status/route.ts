import { getBrokerUrl, getPlatform, isPlatformConnected } from "@/lib/parking/mqtt-platform";
import { listSimulators } from "@/lib/parking/simulator";
import { COLLECTIONS, getParkingDb } from "@/lib/parking/store";

interface DeviceSummary {
  sn: string;
  ip: string | null;
  online: boolean;
  deviceType: string | null;
  lastSeenAt: string | null;
}

async function listKnownDevices(): Promise<DeviceSummary[]> {
  const db = await getParkingDb();
  const docs = await db
    .collection(COLLECTIONS.devices)
    .find({}, { projection: { sn: 1, online: 1, lastSeenAt: 1, devInfo: 1 } })
    .sort({ lastSeenAt: -1 })
    .limit(50)
    .toArray();
  return docs.map((d) => ({
    sn: String(d.sn),
    ip: (d.devInfo?.devIP as string | undefined) ?? null,
    online: Boolean(d.online),
    deviceType: (d.devInfo?.deviceType as string | undefined) ?? null,
    lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
  }));
}

// 平台 MQTT 連線、模擬設備與區網內已知（上線過）的實體設備狀態
export async function GET() {
  let broker = "";
  let error: string | null = null;
  let devices: DeviceSummary[] = [];
  try {
    broker = getBrokerUrl();
    getPlatform();
    devices = await listKnownDevices();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return Response.json({
    broker,
    platformConnected: isPlatformConnected(),
    error,
    simulators: listSimulators(),
    devices,
  });
}
