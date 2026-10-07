import "server-only";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";

export const COLLECTIONS = {
  /** 所有 MQTT 上下行封包紀錄 */
  messages: "mqtt_messages",
  /** 平台下發的命令與 Receipt 狀態，以 requestId 關聯 */
  commands: "mqtt_commands",
  /** 設備狀態（上線、心跳、版本資訊） */
  devices: "devices",
  /** 車牌辨識結果（HTTP 與 MQTT），以 guid 去重 */
  plateResults: "plate_results",
} as const;

export type CommandStatus = "pending" | "success" | "failed" | "timeout" | "sent";

const globalForStore = globalThis as typeof globalThis & {
  _parkingIndexesReady?: Promise<void>;
};

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection(COLLECTIONS.messages).createIndex({ receivedAt: -1 }),
    db.collection(COLLECTIONS.messages).createIndex({ requestId: 1 }),
    db.collection(COLLECTIONS.commands).createIndex({ requestId: 1, sn: 1 }),
    db.collection(COLLECTIONS.commands).createIndex({ sentAt: -1 }),
    db.collection(COLLECTIONS.devices).createIndex({ sn: 1 }, { unique: true }),
    // 規格建議以 guid 去重，避免 MQTT 重送或離線補傳造成重複進出場紀錄；HTTP 結果沒有 guid
    db
      .collection(COLLECTIONS.plateResults)
      .createIndex({ guid: 1 }, { unique: true, partialFilterExpression: { guid: { $type: "string" } } }),
    db.collection(COLLECTIONS.plateResults).createIndex({ created_at: -1 }),
  ]);
}

/** 取得 carpark 資料庫，第一次呼叫時建立停車設備相關索引 */
export async function getParkingDb(): Promise<Db> {
  const db = await getDb();
  if (!globalForStore._parkingIndexesReady) {
    const ready = ensureIndexes(db);
    ready.catch(() => {
      globalForStore._parkingIndexesReady = undefined;
    });
    globalForStore._parkingIndexesReady = ready;
  }
  await globalForStore._parkingIndexesReady;
  return db;
}
