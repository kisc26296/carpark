import "server-only";
import fs from "node:fs/promises";
import { ObjectId, type Filter, type WithId } from "mongodb";
import { normalizePlate } from "./monthly-rental-shared";
import type { CameraInfo, CameraRole, ParkingEntry } from "./parking-entry-shared";
import { COLLECTIONS, getParkingDb } from "./store";
import { checkTaiwanPlate } from "./tw-plate";

// 車輛進出場紀錄（carpark.parking_entries）。
// 攝影機辨識結果存檔後會呼叫 ingestPlateResult：入口攝影機新增進場紀錄、出口攝影機把場內紀錄設為已出場；
// 攝影機是入口或出口記在 devices 的 role 欄位，在進場紀錄頁指定。

// 同一車牌在入口重複被辨識（車停在柵欄前、設備重送）時，這段時間內只算一次進場
const REPEAT_ENTRY_MS = 10 * 60 * 1000;
// 只有這幾種結果代表真的有車經過；BackResult（折返）、CarRetention（滯留）不影響進出場
const INGEST_COMMANDS = new Set(["Result", "OfflineResult", "HttpResult"]);
const INVALID_PLATES = new Set(["", "UNLICENSED", "UNKNOWN", "NONE"]);

interface EntryDoc {
  no: number;
  plate: string;
  /** 攝影機原本辨識的車號；有依台灣車牌格式修正時才有值 */
  plateRaw: string | null;
  /** 車號是否符合台灣車牌格式 */
  plateValid: boolean;
  /** 修正內容或格式問題說明 */
  plateNote: string | null;
  entryTime: Date;
  entryDeviceSn: string | null;
  entryResultId: string | null;
  entryImagePath: string | null;
  exited: boolean;
  exitTime: Date | null;
  exitDeviceSn: string | null;
  exitResultId: string | null;
  exitImagePath: string | null;
  exitNote: string | null;
  payTime: Date | null;
  invoiceNo: string;
  amount: number | null;
  source: "auto" | "manual";
  createdAt: Date;
  updatedAt: Date;
}

/** 給 API 用的錯誤，帶 HTTP 狀態碼 */
export class ParkingEntryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toEntry = ({ _id, ...d }: WithId<EntryDoc>): ParkingEntry => ({
  ...d,
  id: _id.toHexString(),
  // 加入車牌校正前建立的紀錄沒有這些欄位
  plateRaw: d.plateRaw ?? null,
  plateValid: d.plateValid ?? true,
  plateNote: d.plateNote ?? null,
  entryTime: d.entryTime.toISOString(),
  exitTime: iso(d.exitTime),
  payTime: iso(d.payTime),
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

async function entries() {
  const db = await getParkingDb();
  return db.collection<EntryDoc>(COLLECTIONS.parkingEntries);
}

/** 取下一個流水編號（counters 原子遞增，兩台攝影機同時辨識也不會拿到同一號） */
async function nextNo(): Promise<number> {
  const db = await getParkingDb();
  const counters = db.collection<{ _id: string; seq: number }>(COLLECTIONS.counters);
  const res = await counters.findOneAndUpdate(
    { _id: COLLECTIONS.parkingEntries },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return res!.seq;
}

const findOpenEntry = async (plate: string) =>
  (await entries()).findOne({ plate, exited: false }, { sort: { entryTime: -1 } });

function newEntry(fields: Partial<EntryDoc> & Pick<EntryDoc, "no" | "plate" | "entryTime" | "source">): EntryDoc {
  const now = new Date();
  return {
    plateRaw: null,
    plateValid: true,
    plateNote: null,
    entryDeviceSn: null,
    entryResultId: null,
    entryImagePath: null,
    exited: false,
    exitTime: null,
    exitDeviceSn: null,
    exitResultId: null,
    exitImagePath: null,
    exitNote: null,
    payTime: null,
    invoiceNo: "",
    amount: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

// ---- 攝影機辨識自動處理 ----

/** 設備的 triggT 是本地時間「YYYY-MM-DD HH:mm:ss」；解析失敗就用伺服器收到的時間 */
function eventTime(triggerTime: unknown, fallback: unknown): Date {
  if (typeof triggerTime === "string") {
    const d = new Date(triggerTime.trim().replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback instanceof Date ? fallback : new Date();
}

export type IngestOutcome =
  | { action: "skipped"; reason: string }
  | { action: "entered"; no: number; plate: string; corrected: string | null; closedPrevious: number | null }
  | { action: "repeat"; no: number }
  | { action: "exited"; no: number }
  | { action: "no-open-entry" };

/** 辨識結果存檔後呼叫：依攝影機角色建立進場紀錄或設定出場 */
export async function ingestPlateResult(result: Record<string, unknown>, resultId: string): Promise<IngestOutcome> {
  if (!INGEST_COMMANDS.has(String(result.command))) return { action: "skipped", reason: "不是進出場辨識結果" };
  if (result.is_car_exist === "car-free") return { action: "skipped", reason: "無車" };
  const check = checkTaiwanPlate(String(result.plate_raw ?? ""));
  if (INVALID_PLATES.has(check.original)) return { action: "skipped", reason: "沒有辨識到車牌" };
  // 攝影機認錯的字依台灣車牌格式修正；出口也要修正，才對得到入口修正後的紀錄
  const plate = check.plate;

  const sn = String(result.device_sn ?? "");
  const role = sn ? await getCameraRole(sn) : null;
  if (!role) return { action: "skipped", reason: "攝影機未指定入口或出口" };

  const time = eventTime(result.trigger_time, result.created_at);
  const imagePath = typeof result.image_saved_path === "string" ? result.image_saved_path : null;
  const col = await entries();
  // 出口找不到修正後的車號時，再用攝影機原始車號找一次（例如入場時沒修正、出場時修正了）
  const open =
    (await findOpenEntry(plate)) ?? (check.corrected && role === "exit" ? await findOpenEntry(check.original) : null);

  if (role === "exit") {
    if (!open) return { action: "no-open-entry" };
    await col.updateOne(
      { _id: open._id },
      {
        $set: {
          exited: true,
          exitTime: time,
          exitDeviceSn: sn,
          exitResultId: resultId,
          exitImagePath: imagePath,
          updatedAt: new Date(),
        },
      },
    );
    return { action: "exited", no: open.no };
  }

  if (open && Math.abs(time.getTime() - open.entryTime.getTime()) < REPEAT_ENTRY_MS) {
    return { action: "repeat", no: open.no };
  }
  // 場內還有這台車的舊紀錄，代表上次出場沒被辨識到，先把舊的結束掉
  if (open) {
    await col.updateOne(
      { _id: open._id },
      { $set: { exited: true, exitTime: time, exitNote: "再次進場，自動結束舊紀錄", updatedAt: new Date() } },
    );
  }
  const no = await nextNo();
  await col.insertOne(
    newEntry({
      no,
      plate,
      plateRaw: check.corrected ? check.original : null,
      plateValid: check.valid,
      plateNote: check.note,
      entryTime: time,
      entryDeviceSn: sn,
      entryResultId: resultId,
      entryImagePath: imagePath,
      source: "auto",
    }),
  );
  return { action: "entered", no, plate, corrected: check.corrected ? check.original : null, closedPrevious: open?.no ?? null };
}

// ---- 頁面操作 ----

export async function listEntries({
  scope,
  plate,
  limit,
}: {
  scope: "inside" | "all";
  plate: string;
  limit: number;
}): Promise<ParkingEntry[]> {
  const filter: Filter<EntryDoc> = {};
  if (scope === "inside") filter.exited = false;
  const keyword = normalizePlate(plate);
  if (keyword) filter.plate = { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
  const docs = await (await entries()).find(filter).sort({ entryTime: -1 }).limit(limit).toArray();
  return docs.map(toEntry);
}

// ---- 繳費機 ----

export interface KioskVehicle {
  entry: ParkingEntry;
  hasImage: boolean;
}

/**
 * 繳費機用：車牌包含 digits 的場內車輛；digits 為空時列出全部場內車輛。
 * 最近進場的在前
 */
export async function searchInsideVehicles(digits: string, limit = 500): Promise<KioskVehicle[]> {
  const filter: Filter<EntryDoc> = { exited: false };
  const keyword = normalizePlate(digits).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (keyword) filter.plate = { $regex: keyword };
  const docs = await (await entries()).find(filter).sort({ entryTime: -1 }).limit(limit).toArray();
  return docs.map((doc) => ({ entry: toEntry(doc), hasImage: Boolean(doc.entryImagePath || doc.entryResultId) }));
}

/** 繳費機點選車輛後讀取該筆場內紀錄；已出場或不存在時丟錯 */
export async function getInsideEntry(id: unknown): Promise<ParkingEntry> {
  const doc = await (await entries()).findOne({ _id: toObjectId(id) });
  if (!doc) throw new ParkingEntryError("找不到這筆進場紀錄", 404);
  if (doc.exited) throw new ParkingEntryError("此車輛已出場", 409);
  return toEntry(doc);
}

/** 繳費機收款完成後記錄繳費時間與金額 */
export const markPaid = (id: unknown, amount: number) => updateEntry(id, { payTime: new Date(), amount });

function parseTime(value: unknown, label: string): Date {
  const d = typeof value === "string" && value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new ParkingEntryError(`${label}格式錯誤`, 400);
  return d;
}

/** 人員手動輸入的車牌不自動修改，只標示是否符合台灣車牌格式 */
function manualPlateCheck(plate: string): Pick<EntryDoc, "plateValid" | "plateNote"> {
  const check = checkTaiwanPlate(plate);
  const valid = check.valid && !check.corrected;
  return { plateValid: valid, plateNote: valid ? null : `${plate} 不符合台灣車牌格式，請確認` };
}

function parsePlate(value: unknown): string {
  const plate = normalizePlate(typeof value === "string" ? value : "");
  if (!plate) throw new ParkingEntryError("請輸入車牌", 400);
  return plate;
}

export async function createManualEntry(input: { plate?: unknown; entryTime?: unknown }): Promise<ParkingEntry> {
  const plate = parsePlate(input.plate);
  const entryTime = input.entryTime ? parseTime(input.entryTime, "入場時間") : new Date();
  const open = await findOpenEntry(plate);
  if (open) throw new ParkingEntryError(`車牌 ${plate} 已在場內（編號 ${open.no}）`, 409);
  const doc = newEntry({ no: await nextNo(), plate, entryTime, source: "manual", ...manualPlateCheck(plate) });
  const { insertedId } = await (await entries()).insertOne(doc);
  return toEntry({ _id: insertedId, ...doc });
}

const toObjectId = (id: unknown) => {
  if (typeof id !== "string" || !ObjectId.isValid(id)) throw new ParkingEntryError("id 格式錯誤", 400);
  return new ObjectId(id);
};

async function updateEntry(id: unknown, set: Partial<EntryDoc>): Promise<ParkingEntry> {
  const updated = await (await entries()).findOneAndUpdate(
    { _id: toObjectId(id) },
    { $set: { ...set, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ParkingEntryError("找不到這筆進場紀錄", 404);
  return toEntry(updated);
}

/** 修改車牌或入場時間 */
export async function editEntry(input: { id?: unknown; plate?: unknown; entryTime?: unknown }): Promise<ParkingEntry> {
  const set: Partial<EntryDoc> = {};
  if (input.plate !== undefined) {
    set.plate = parsePlate(input.plate);
    Object.assign(set, manualPlateCheck(set.plate));
    const open = await findOpenEntry(set.plate);
    if (open && open._id.toHexString() !== input.id) {
      throw new ParkingEntryError(`車牌 ${set.plate} 已在場內（編號 ${open.no}）`, 409);
    }
  }
  if (input.entryTime !== undefined) set.entryTime = parseTime(input.entryTime, "入場時間");
  return updateEntry(input.id, set);
}

/** 手動設定已出場 */
export const markExited = (id: unknown) => updateEntry(id, { exited: true, exitTime: new Date(), exitNote: "手動設定已出場" });

export async function deleteEntry(id: unknown): Promise<void> {
  const res = await (await entries()).deleteOne({ _id: toObjectId(id) });
  if (res.deletedCount === 0) throw new ParkingEntryError("找不到這筆進場紀錄", 404);
}

/**
 * 讀取進場或出場照片。只依紀錄裡存的路徑讀檔，不接受外部傳入路徑，避免被拿來讀主機上的其他檔案；
 * 檔案被刪掉時改用 plate_results 裡保存的 Base64 原圖。沒有照片回傳 null。
 */
export async function getEntryImage(id: unknown, kind: "entry" | "exit"): Promise<Buffer | null> {
  const entry = await (await entries()).findOne({ _id: toObjectId(id) });
  if (!entry) throw new ParkingEntryError("找不到這筆進場紀錄", 404);
  const imagePath = kind === "entry" ? entry.entryImagePath : entry.exitImagePath;
  const resultId = kind === "entry" ? entry.entryResultId : entry.exitResultId;

  if (imagePath) {
    try {
      return await fs.readFile(imagePath);
    } catch {
      // 檔案被移走或刪除，往下改用資料庫裡的原圖
    }
  }
  if (resultId && ObjectId.isValid(resultId)) {
    const db = await getParkingDb();
    const result = await db
      .collection<{ image_base64?: string | null }>(COLLECTIONS.plateResults)
      .findOne({ _id: new ObjectId(resultId) }, { projection: { image_base64: 1 } });
    const base64 = result?.image_base64;
    if (base64) return Buffer.from(base64.slice(base64.indexOf(",") + 1), "base64");
  }
  return null;
}

// ---- 攝影機入口 / 出口設定 ----

export async function getCameraRole(sn: string): Promise<CameraRole | null> {
  const db = await getParkingDb();
  const device = await db.collection<{ sn: string; role?: CameraRole | null }>(COLLECTIONS.devices).findOne({ sn });
  return device?.role ?? null;
}

/** 列出所有出現過的攝影機：MQTT 連線過的設備，加上只用 HTTP 上傳過辨識結果的設備 */
export async function listCameras(): Promise<CameraInfo[]> {
  const db = await getParkingDb();
  const devices = await db
    .collection<{
      sn: string;
      online?: boolean;
      lastSeenAt?: Date;
      role?: CameraRole | null;
      devInfo?: { devIP?: string; deviceType?: string };
    }>(COLLECTIONS.devices)
    .find({}, { projection: { _id: 0, sn: 1, online: 1, lastSeenAt: 1, role: 1, devInfo: 1 } })
    .toArray();
  const httpSns: string[] = await db.collection(COLLECTIONS.plateResults).distinct("device_sn", { source: "http" });

  const cameras = new Map<string, CameraInfo>();
  for (const d of devices) {
    cameras.set(d.sn, {
      sn: d.sn,
      ip: d.devInfo?.devIP ?? null,
      deviceType: d.devInfo?.deviceType ?? null,
      online: d.online ?? null,
      lastSeenAt: iso(d.lastSeenAt ?? null),
      role: d.role ?? null,
    });
  }
  for (const sn of httpSns) {
    if (sn && !cameras.has(sn)) {
      cameras.set(sn, { sn, ip: null, deviceType: null, online: null, lastSeenAt: null, role: null });
    }
  }
  return [...cameras.values()].sort((a, b) => a.sn.localeCompare(b.sn));
}

export async function setCameraRole(sn: unknown, role: unknown): Promise<void> {
  if (typeof sn !== "string" || !sn) throw new ParkingEntryError("缺少攝影機序號", 400);
  if (role !== "entry" && role !== "exit" && role !== null) {
    throw new ParkingEntryError("role 必須是 entry / exit / null", 400);
  }
  const db = await getParkingDb();
  // HTTP 設備可能還沒有 devices 紀錄，用 upsert 建一筆
  await db
    .collection(COLLECTIONS.devices)
    .updateOne({ sn }, { $set: { role }, $setOnInsert: { sn, firstSeenAt: new Date() } }, { upsert: true });
}
