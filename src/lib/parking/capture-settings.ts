import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { CameraRole } from "./parking-entry-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 辨識圖片要存去哪個本機資料夾，存在 MongoDB carpark.system_settings（_id: "capture"），
// 伺服器啟動後第一次用到時讀取，之後用 globalThis 快取，避免每張照片都查一次資料庫。
// dir 是共用資料夾；入口、出口攝影機可以各自指定資料夾，沒指定就存到共用資料夾。
// 早期版本存在專案根目錄的 .parking-capture-settings.json，資料庫還沒有設定時會自動匯入一次。

const SETTINGS_ID = "capture";
const LEGACY_FILE = path.join(process.cwd(), ".parking-capture-settings.json");

export type CaptureTarget = "default" | CameraRole;

export interface CaptureSettings {
  dir: string | null;
  entryDir: string | null;
  exitDir: string | null;
}

const FIELDS: Record<CaptureTarget, keyof CaptureSettings> = { default: "dir", entry: "entryDir", exit: "exitDir" };

const EMPTY: CaptureSettings = { dir: null, entryDir: null, exitDir: null };

const globalForCapture = globalThis as typeof globalThis & {
  _parkingCaptureSettings?: Promise<CaptureSettings>;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const pick = (v: Partial<Record<keyof CaptureSettings, unknown>> | null | undefined): CaptureSettings => ({
  dir: str(v?.dir),
  entryDir: str(v?.entryDir),
  exitDir: str(v?.exitDir),
});

async function settingsCollection() {
  const db = await getParkingDb();
  return db.collection<CaptureSettings & { _id: string; updatedAt?: Date }>(COLLECTIONS.systemSettings);
}

async function readLegacyFile(): Promise<CaptureSettings | null> {
  try {
    return pick(JSON.parse(await fs.readFile(LEGACY_FILE, "utf8")));
  } catch {
    return null;
  }
}

async function readSettings(): Promise<CaptureSettings> {
  const col = await settingsCollection();
  const doc = await col.findOne({ _id: SETTINGS_ID });
  if (doc) return pick(doc);

  // 資料庫還沒有設定：把舊版 JSON 檔的設定搬進來，之後都以資料庫為準
  const legacy = (await readLegacyFile()) ?? { ...EMPTY };
  await col.updateOne({ _id: SETTINGS_ID }, { $setOnInsert: { ...legacy, updatedAt: new Date() } }, { upsert: true });
  return pick(await col.findOne({ _id: SETTINGS_ID }));
}

function loadSettings(): Promise<CaptureSettings> {
  if (!globalForCapture._parkingCaptureSettings) {
    const loading = readSettings();
    // 讀取失敗（例如資料庫還沒連上）就清掉快取，下次再試
    loading.catch(() => {
      globalForCapture._parkingCaptureSettings = undefined;
    });
    globalForCapture._parkingCaptureSettings = loading;
  }
  return globalForCapture._parkingCaptureSettings;
}

async function saveField(field: keyof CaptureSettings, value: string | null): Promise<void> {
  const col = await settingsCollection();
  await col.updateOne({ _id: SETTINGS_ID }, { $set: { [field]: value, updatedAt: new Date() } }, { upsert: true });
  globalForCapture._parkingCaptureSettings = Promise.resolve({ ...(await loadSettings()), [field]: value });
}

export async function getCaptureSettings(): Promise<CaptureSettings> {
  return { ...(await loadSettings()) };
}

/** 某台攝影機的辨識圖片要存的資料夾：入口 / 出口有各自設定就用各自的，否則用共用資料夾；都沒設定回傳 null */
export async function getCaptureDir(role?: CameraRole | null): Promise<string | null> {
  const settings = await loadSettings();
  if (role === "entry" && settings.entryDir) return settings.entryDir;
  if (role === "exit" && settings.exitDir) return settings.exitDir;
  return settings.dir;
}

/** 設定辨識圖片儲存資料夾：轉絕對路徑、資料夾不存在就建立、存進資料庫 */
export async function setCaptureDir(dir: string, target: CaptureTarget = "default"): Promise<string> {
  const resolved = path.resolve(dir);
  await fs.mkdir(resolved, { recursive: true });
  await saveField(FIELDS[target], resolved);
  return resolved;
}

/** 清除設定；共用資料夾清除後辨識結果就不再自動存檔，入口 / 出口清除後改存到共用資料夾 */
export async function clearCaptureDir(target: CaptureTarget = "default"): Promise<void> {
  await saveField(FIELDS[target], null);
}
