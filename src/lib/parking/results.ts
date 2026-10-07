import "server-only";
import { MongoServerError } from "mongodb";
import type { MqttEnvelope } from "./protocol";
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
    return { id: res.insertedId.toString(), duplicate: false };
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
    trigger_time: str(data.triggT),
    result_type: num(data.resultType),
    confidence: num(data.confid),
    image_url: str(data.picN_full) || null,
    image_base64: str(data.picNFile) || null,
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
  // imageFile 可能很大，raw 不重複保存圖片
  const { imageFile, ...rawWithoutImage } = body;
  return insertResult({
    source: "http",
    command: "HttpResult",
    device_sn: str(body.sn),
    request_id: null,
    plate_raw: plateRaw,
    plate: encrypted === "Encrypted" ? null : plateRaw,
    plate_color: num(body.colorType),
    encrypted,
    trigger_time: str(attach.carArriveTime),
    result_type: null,
    confidence: num(attach.confidence),
    image_url: null,
    image_base64: str(imageFile) || null,
    open_gate: null,
    // HTTP 只有 isFakePlate（TRUE = 假牌），語意與 MQTT validPlate 相反，分開保存
    is_fake_plate: str(attach.isFakePlate),
    is_car_back: str(attach.isCarBack),
    raw: rawWithoutImage,
    created_at: new Date(),
  });
}
