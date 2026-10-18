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
  /** 月租客戶，編號不可重複 */
  monthlyRentals: "monthly_rentals",
  /** 車輛進出場紀錄，入口攝影機辨識自動建立、出口攝影機辨識自動出場 */
  parkingEntries: "parking_entries",
  /** 流水編號計數器，_id 為使用編號的 collection 名稱 */
  counters: "counters",
  /** 系統設定（辨識照片資料夾等），一種設定一筆，_id 為設定名稱 */
  systemSettings: "system_settings",
  /** 收找零紀錄：硬幣 / 收鈔機數量，只有一筆（_id: "current"） */
  cashInventory: "cash_inventory",
  /** 收找零紀錄的手動操作紀錄（修改數量、補幣、收鈔機歸零） */
  cashInventoryLogs: "cash_inventory_logs",
  /** 登入使用者帳號（密碼雜湊、角色與功能權限），帳號不可重複 */
  users: "user",
  /** 進出口辨識確認：每次連續觸發辨識的結果、是否開閘與原因 */
  gateVerifications: "gate_verifications",
  /** 繳費機開立的電子發票（ezPay），開立失敗也會記錄 */
  invoices: "invoices",
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
    db.collection(COLLECTIONS.monthlyRentals).createIndex({ no: 1 }, { unique: true }),
    db.collection(COLLECTIONS.monthlyRentals).createIndex({ plates: 1 }),
    db.collection(COLLECTIONS.parkingEntries).createIndex({ no: 1 }, { unique: true }),
    db.collection(COLLECTIONS.parkingEntries).createIndex({ plate: 1, exited: 1, entryTime: -1 }),
    db.collection(COLLECTIONS.parkingEntries).createIndex({ entryTime: -1 }),
    db.collection(COLLECTIONS.cashInventoryLogs).createIndex({ time: -1 }),
    db.collection(COLLECTIONS.gateVerifications).createIndex({ startedAt: -1 }),
    db.collection(COLLECTIONS.invoices).createIndex({ createdAt: -1 }),
    db.collection(COLLECTIONS.invoices).createIndex({ invoiceNumber: 1 }),
    // user 集合裡可能有沒有帳號的其他資料，只對有帳號的文件要求不重複
    db
      .collection(COLLECTIONS.users)
      .createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } }),
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
