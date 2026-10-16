import "server-only";
import { sendCommand } from "./mqtt-platform";
import { CAMERA_ROLE_LABELS, type CameraRole } from "./parking-entry-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 進出口開關閘與車位數：
// - 開閘 / 關閘：對「資料庫設定」指定為入口 / 出口的攝影機下發 MQTT Open / Close 命令（柵欄由攝影機的繼電器控制）
// - 車位數：最大車位數與手動調整值存在 carpark.system_settings（_id: "capacity"）；
//   剩餘車位數 = 最大車位數 − 場內車輛數（未出場的進場紀錄）+ 手動調整值。
//   手動修改剩餘車位數時存下與自動計算值的差（adjust），之後仍會隨進出場增減

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
  /** 最大車位數 − 場內車輛數 + 手動調整值，最小為 0 */
  remaining: number;
  /** 目前場內（未出場）的進場紀錄數 */
  inside: number;
  /** 手動修改剩餘車位數時，與自動計算值（最大車位數 − 場內車輛數）的差 */
  adjust: number;
  updatedAt: string | null;
}

async function countInside(): Promise<number> {
  const db = await getParkingDb();
  return db.collection(COLLECTIONS.parkingEntries).countDocuments({ exited: false });
}

export async function getCapacity(): Promise<Capacity> {
  const db = await getParkingDb();
  const [doc, inside] = await Promise.all([
    db
      .collection<{ _id: string; max?: number; adjust?: number; updatedAt?: Date }>(COLLECTIONS.systemSettings)
      .findOne({ _id: CAPACITY_ID }),
    countInside(),
  ]);
  const max = doc?.max ?? 0;
  const adjust = doc?.adjust ?? 0;
  return {
    max,
    remaining: Math.max(0, max - inside + adjust),
    inside,
    adjust,
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

// body: { max, remaining? }：有帶 remaining 才更新手動調整值，沒帶則保留原本的調整值
export async function saveCapacity(input: { max?: unknown; remaining?: unknown }): Promise<Capacity> {
  const max = Number(input.max);
  if (!Number.isInteger(max) || max < 0) throw new GateCapacityError("最大車位數必須是 0 以上的整數", 400);

  const set: { max: number; adjust?: number; updatedAt: Date } = { max, updatedAt: new Date() };
  if (input.remaining !== undefined && input.remaining !== null && input.remaining !== "") {
    const remaining = Number(input.remaining);
    if (!Number.isInteger(remaining) || remaining < 0) {
      throw new GateCapacityError("剩餘車位數必須是 0 以上的整數", 400);
    }
    set.adjust = remaining - (max - (await countInside()));
  }

  const db = await getParkingDb();
  await db
    .collection<{ _id: string; max: number; adjust?: number; updatedAt: Date }>(COLLECTIONS.systemSettings)
    // 舊版存的 remaining 欄位已改用 adjust，順便移除
    .updateOne({ _id: CAPACITY_ID }, { $set: set, $unset: { remaining: "" } }, { upsert: true });
  return getCapacity();
}
