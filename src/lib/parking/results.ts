import "server-only";
import { MongoServerError } from "mongodb";
import { saveCaptureImage } from "./image-storage";
import { getCameraRole, ingestPlateResult } from "./parking-entries";
import type { MqttEnvelope } from "./protocol";
import { emitPlateResult } from "./result-events";
import { COLLECTIONS, getParkingDb } from "./store";

// 依規格第 8 節「建議後端資料模型」保存辨識結果

type Data = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));

export interface SaveResultOutcome {
  id: string | null;
  duplicate: boolean;
}

async function insertResult(doc: Data): Promise<SaveResultOutcome> {
  const db = await getParkingDb();
  try {
    const res = await db.collection(COLLECTIONS.plateResults).insertOne(doc);
    const id = res.insertedId.toString();
    // 即時監測用：重送/補傳（下面的 duplicate 分支）不算新事件，不會重複推播
    emitPlateResult({
      id,
      source: doc.source as "mqtt" | "http",
      command: String(doc.command ?? ""),
      device_sn: String(doc.device_sn ?? ""),
      plate_raw: String(doc.plate_raw ?? ""),
      plate_color: doc.plate_color ?? null,
      confidence: (doc.confidence as number | null) ?? null,
      is_car_exist: (doc.is_car_exist as string | null) ?? null,
      valid_plate: (doc.valid_plate as string | null) ?? null,
      trigger_time: String(doc.trigger_time ?? ""),
      image_base64: (doc.image_base64 as string | null) ?? null,
      image_saved_path: (doc.image_saved_path as string | null) ?? null,
      created_at: (doc.created_at as Date).toISOString(),
    });
    // 依攝影機是入口或出口建立進場紀錄 / 設定出場；失敗只記 log，不影響辨識結果本身已存檔
    try {
      const outcome = await ingestPlateResult(doc, id);
      if (outcome.action !== "skipped") console.log(`[entries] ${doc.device_sn} ${doc.plate_raw}:`, outcome);
    } catch (error) {
      console.error("[entries] 進出場紀錄處理失敗:", error instanceof Error ? error.message : error);
    }
    return { id, duplicate: false };
  } catch (error) {
    // guid 唯一索引衝突 = 重送或補傳的同一筆結果
    if (error instanceof MongoServerError && error.code === 11000) {
      return { id: null, duplicate: true };
    }
    throw error;
  }
}

/** MQTT Result / OfflineResult / BackResult / CarRetention */
export async function saveMqttPlateResult(envelope: MqttEnvelope, data: Data): Promise<SaveResultOutcome> {
  const plateRaw = str(data.carNO);
  const encrypted = str(data.encrypted);
  const triggerTime = str(data.triggT);
  const imageBase64 = str(data.picNFile);
  const imageSavedPath = imageBase64
    ? await saveCaptureImage({ time: triggerTime, plate: plateRaw, base64: imageBase64, role: await getCameraRole(envelope.sn) })
    : null;
  return insertResult({
    source: "mqtt",
    command: envelope.command,
    device_sn: envelope.sn,
    request_id: envelope.requestId,
    guid: str(data.guid) || undefined,
    plate_raw: plateRaw,
    // 加密車牌需依 EncryptionStatus 解密，這裡只保存原始值
    plate: encrypted === "Encrypted" ? null : plateRaw,
    plate_color: str(data.carNOC),
    encrypted,
    trigger_time: triggerTime,
    result_type: num(data.resultType),
    confidence: num(data.confid),
    image_url: str(data.picN_full) || null,
    image_base64: imageBase64 || null,
    image_saved_path: imageSavedPath,
    open_gate: num(data.openGate),
    valid_plate: str(data.validPlate),
    is_car_exist: str(data.IsCarExist),
    raw: data,
    created_at: new Date(),
  });
}

/** 2.1 HTTP 車牌辨識結果 POST */
export async function saveHttpPlateResult(body: Data): Promise<SaveResultOutcome> {
  const attach = (body.attachInfo && typeof body.attachInfo === "object" ? body.attachInfo : {}) as Data;
  const encrypted = str(attach.encryptInfo);
  const plateRaw = str(body.license);
  const triggerTime = str(attach.carArriveTime);
  // imageFile 可能很大，raw 不重複保存圖片
  const { imageFile, ...rawWithoutImage } = body;
  const imageBase64 = str(imageFile);
  const imageSavedPath = imageBase64
    ? await saveCaptureImage({ time: triggerTime, plate: plateRaw, base64: imageBase64, role: await getCameraRole(str(body.sn)) })
    : null;
  return insertResult({
    source: "http",
    command: "HttpResult",
    device_sn: str(body.sn),
    request_id: null,
    plate_raw: plateRaw,
    plate: encrypted === "Encrypted" ? null : plateRaw,
    plate_color: num(body.colorType),
    encrypted,
    trigger_time: triggerTime,
    result_type: null,
    confidence: num(attach.confidence),
    image_url: null,
    image_base64: imageBase64 || null,
    image_saved_path: imageSavedPath,
    open_gate: null,
    // HTTP 只有 isFakePlate（TRUE = 假牌），語意與 MQTT validPlate 相反，分開保存
    is_fake_plate: str(attach.isFakePlate),
    is_car_back: str(attach.isCarBack),
    raw: rawWithoutImage,
    created_at: new Date(),
  });
}
