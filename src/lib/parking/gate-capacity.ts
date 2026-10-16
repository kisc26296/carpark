import "server-only";
import { sendCommand } from "./mqtt-platform";
import { CAMERA_ROLE_LABELS, type CameraRole } from "./parking-entry-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 進出口開關閘與車位數：
// - 開閘 / 關閘：對「資料庫設定」指定為入口 / 出口的攝影機下發 MQTT Open / Close 命令（柵欄由攝影機的繼電器控制）
// - 車位數：最大車位數存在 carpark.system_settings（_id: "capacity"）；
//   剩餘車位數 = 最大車位數 − 場內車輛數（未出場的進場紀錄），依進出場自動計算，不另外存

const CAPACITY_ID = "capacity";

export class GateCapacityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GateResult {
  sn: string;
  ok: boolean;
  status: string;
  error?: string;
}

export type GateAction = "open" | "close";

const GATE_COMMANDS: Record<GateAction, string> = { open: "Open", close: "Close" };

export async function controlGate(role: CameraRole, action: GateAction): Promise<GateResult[]> {
  const db = await getParkingDb();
  const cameras = await db
    .collection<{ sn: string; role?: CameraRole | null }>(COLLECTIONS.devices)
    .find({ role }, { projection: { sn: 1 } })
    .toArray();
  if (cameras.length === 0) {
    throw new GateCapacityError(`尚未指定${CAMERA_ROLE_LABELS[role]}攝影機，請到「資料庫設定」勾選`, 400);
  }
  return Promise.all(
    cameras.map(async ({ sn }): Promise<GateResult> => {
      try {
        const result = await sendCommand(sn, GATE_COMMANDS[action], null);
        return { sn, ok: result.status === "success" || result.status === "sent", status: result.status };
      } catch (error) {
        return { sn, ok: false, status: "failed", error: error instanceof Error ? error.message : "下發失敗" };
      }
    }),
  );
}

export interface Capacity {
  max: number;
  /** 最大車位數 − 場內車輛數，最小為 0 */
  remaining: number;
  /** 目前場內（未出場）的進場紀錄數 */
  inside: number;
  updatedAt: string | null;
}

export async function getCapacity(): Promise<Capacity> {
  const db = await getParkingDb();
  const [doc, inside] = await Promise.all([
    db
      .collection<{ _id: string; max?: number; updatedAt?: Date }>(COLLECTIONS.systemSettings)
      .findOne({ _id: CAPACITY_ID }),
    db.collection(COLLECTIONS.parkingEntries).countDocuments({ exited: false }),
  ]);
  const max = doc?.max ?? 0;
  return {
    max,
    remaining: Math.max(0, max - inside),
    inside,
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

export async function saveCapacity(input: { max?: unknown }): Promise<Capacity> {
  const max = Number(input.max);
  if (!Number.isInteger(max) || max < 0) throw new GateCapacityError("最大車位數必須是 0 以上的整數", 400);

  const db = await getParkingDb();
  await db
    .collection<{ _id: string; max: number; updatedAt: Date }>(COLLECTIONS.systemSettings)
    // 舊版手動輸入的 remaining 已改為自動計算，順便移除
    .updateOne({ _id: CAPACITY_ID }, { $set: { max, updatedAt: new Date() }, $unset: { remaining: "" } }, { upsert: true });
  return getCapacity();
}
