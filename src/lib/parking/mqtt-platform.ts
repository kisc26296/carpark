import "server-only";
import mqtt, { type MqttClient } from "mqtt";
import { DOWNLINK_COMMANDS } from "./catalog";
import {
  NO_REPLY_COMMANDS,
  PLATE_RESULT_COMMANDS,
  buildEnvelope,
  downloadTopic,
  formatTime,
  parseEnvelope,
  type MqttEnvelope,
} from "./protocol";
import { saveMqttPlateResult } from "./results";
import { COLLECTIONS, getParkingDb, type CommandStatus } from "./store";

// 平台端 MQTT 用戶端：訂閱 upload/+，下發到 download/{ClientID}
// ClientID 預設為設備 SN，這裡沿用預設

type Data = Record<string, unknown>;

export interface CommandReply {
  envelope: MqttEnvelope;
  dataObject: Data | null;
}

interface PlatformState {
  client: MqttClient;
  connected: Promise<void>;
  /** 等待 Receipt 的命令：key = `${sn}|${requestId}` */
  waiters: Map<string, (reply: CommandReply) => void>;
}

const globalForMqtt = globalThis as typeof globalThis & {
  _parkingPlatform?: PlatformState;
};

const waiterKey = (sn: string, requestId: string) => `${sn}|${requestId}`;

export function getBrokerUrl(): string {
  const url = process.env.mqtt_url;
  if (!url) throw new Error("缺少環境變數 mqtt_url，請在 .env.local 設定");
  return url;
}

/** 取得（必要時建立）平台 MQTT 連線，整個 server 共用一個 */
export function getPlatform(): PlatformState {
  if (globalForMqtt._parkingPlatform) return globalForMqtt._parkingPlatform;

  const client = mqtt.connect(getBrokerUrl(), {
    clientId: `carpark-platform-${process.pid}`,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 5000,
  });

  const connected = new Promise<void>((resolve) => {
    client.once("connect", () => resolve());
  });

  const state: PlatformState = { client, connected, waiters: new Map() };

  client.on("connect", () => {
    client.subscribe("upload/+", { qos: 2 }, (err) => {
      if (err) console.error("[mqtt] 訂閱 upload/+ 失敗:", err);
    });
    console.log("[mqtt] 平台已連線", getBrokerUrl());
  });
  client.on("error", (err) => console.error("[mqtt] 連線錯誤:", err.message));
  client.on("message", (topic, payload) => {
    handleUplink(state, topic, payload.toString("utf8")).catch((err) =>
      console.error(`[mqtt] 處理 ${topic} 失敗:`, err),
    );
  });

  globalForMqtt._parkingPlatform = state;
  return state;
}

export function isPlatformConnected(): boolean {
  return globalForMqtt._parkingPlatform?.client.connected ?? false;
}

async function waitConnected(state: PlatformState, timeoutMs = 5000) {
  if (state.client.connected) return;
  await Promise.race([
    state.connected,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`無法連線到 MQTT Broker ${getBrokerUrl()}`)), timeoutMs),
    ),
  ]);
}

async function logMessage(
  direction: "up" | "down",
  topic: string,
  envelope: MqttEnvelope,
  dataObject: Data | null,
  extra: Data = {},
) {
  const db = await getParkingDb();
  await db.collection(COLLECTIONS.messages).insertOne({
    direction,
    topic,
    command: envelope.command,
    requestId: envelope.requestId,
    sn: envelope.sn,
    envelope,
    dataObject,
    receivedAt: new Date(),
    ...extra,
  });
}

/** 發佈下行封包並寫入紀錄；需要回覆的命令會登記為 pending */
async function publishDownlink(
  state: PlatformState,
  envelope: MqttEnvelope,
  origin: "manual" | "auto-reply",
): Promise<void> {
  await waitConnected(state);
  const topic = downloadTopic(envelope.sn);
  const expectsReply = !NO_REPLY_COMMANDS.has(envelope.command);
  const dataObject = envelope.data ? (JSON.parse(envelope.data) as Data) : null;

  const db = await getParkingDb();
  await db.collection(COLLECTIONS.commands).insertOne({
    requestId: envelope.requestId,
    sn: envelope.sn,
    command: envelope.command,
    data: dataObject,
    origin,
    status: (expectsReply ? "pending" : "sent") satisfies CommandStatus,
    sentAt: new Date(),
  });
  await logMessage("down", topic, envelope, dataObject, { origin });

  await new Promise<void>((resolve, reject) => {
    state.client.publish(topic, JSON.stringify(envelope), { qos: 1 }, (err) => (err ? reject(err) : resolve()));
  });
}

export interface SendCommandResult {
  envelope: MqttEnvelope;
  status: CommandStatus;
  reply: CommandReply | null;
  elapsedMs: number;
}

/** 下發命令並等待設備以同一 requestId 回覆（Receipt） */
export async function sendCommand(
  sn: string,
  command: string,
  data: unknown,
  timeoutMs = 5000,
): Promise<SendCommandResult> {
  const state = getPlatform();
  const envelope = buildEnvelope(sn, command, data);
  const start = Date.now();

  if (NO_REPLY_COMMANDS.has(command)) {
    await publishDownlink(state, envelope, "manual");
    return { envelope, status: "sent", reply: null, elapsedMs: Date.now() - start };
  }

  const key = waiterKey(sn, envelope.requestId);
  const replyPromise = new Promise<CommandReply | null>((resolve) => {
    const timer = setTimeout(() => {
      state.waiters.delete(key);
      resolve(null);
    }, timeoutMs);
    state.waiters.set(key, (reply) => {
      clearTimeout(timer);
      state.waiters.delete(key);
      resolve(reply);
    });
  });

  try {
    await publishDownlink(state, envelope, "manual");
  } catch (error) {
    state.waiters.delete(key);
    throw error;
  }

  const reply = await replyPromise;
  let status: CommandStatus;
  if (!reply) {
    status = "timeout";
    const db = await getParkingDb();
    await db
      .collection(COLLECTIONS.commands)
      .updateOne({ requestId: envelope.requestId, sn, status: "pending" }, { $set: { status } });
  } else {
    status = replyStatus(reply.envelope.command, reply.dataObject);
  }
  return { envelope, status, reply, elapsedMs: Date.now() - start };
}

/** 依回覆內容判斷成功/失敗；查詢類回覆（CarInfo、IOStatus 等）沒有結果碼，視為成功 */
function replyStatus(replyCommand: string, data: Data | null): CommandStatus {
  if (!data) return "success";
  if (typeof data.errCode === "number") return data.errCode === 0 ? "success" : "failed";
  // EncryptDevice / ChangeEncryptionKey 的 status：0 成功、1 失敗（EncryptionStatus 的 status 是加密模式，不是結果碼）
  if (replyCommand === "EncryptDevice" || replyCommand === "ChangeEncryptionKey") {
    return data.status === 0 ? "success" : "failed";
  }
  // OverUpdate：-1 更新失敗
  if (replyCommand === "OverUpdate") {
    return data.passruler === -1 || data.carinfo === -1 ? "failed" : "success";
  }
  return "success";
}

/** 平台自動回覆用的下行資料 */
function autoReplyData(command: string): Data | null {
  const spec = DOWNLINK_COMMANDS.find((c) => c.command === command);
  return spec?.sample ?? null;
}

async function handleUplink(state: PlatformState, topic: string, raw: string) {
  let parsed: ReturnType<typeof parseEnvelope>;
  try {
    parsed = parseEnvelope(raw);
  } catch {
    console.warn(`[mqtt] ${topic} 收到非 JSON 訊息，略過`);
    return;
  }
  const { envelope, dataObject } = parsed;
  const sn = envelope.sn || topic.split("/")[1];
  const db = await getParkingDb();

  // 1. 先判斷是否為平台下發命令的回覆（同 sn + requestId 且仍在等待）
  const pending = await db
    .collection(COLLECTIONS.commands)
    .findOneAndUpdate(
      { requestId: envelope.requestId, sn, status: "pending" },
      {
        $set: {
          status: replyStatus(envelope.command, dataObject),
          reply: { command: envelope.command, data: dataObject },
          repliedAt: new Date(),
        },
      },
    );
  const isReply = pending !== null;

  await logMessage("up", topic, envelope, dataObject, isReply ? { replyTo: pending.command } : {});

  if (isReply) {
    state.waiters.get(waiterKey(sn, envelope.requestId))?.({ envelope, dataObject });
  }

  // 2. 更新設備狀態
  const deviceSet: Data = { lastSeenAt: new Date(), online: true, lastCommand: envelope.command };
  if (envelope.command === "Conn" && dataObject?.devInfo) {
    deviceSet.devInfo = parseDevInfo(String(dataObject.devInfo));
    deviceSet.lastConnAt = new Date();
  }
  if (envelope.command === "Rtd" && dataObject && "hasCar" in dataObject) deviceSet.hasCar = dataObject.hasCar;
  if (envelope.command === "OverUpdate" && dataObject) deviceSet.overUpdate = dataObject;
  if (envelope.command === "EncryptionStatus" && dataObject) deviceSet.encryptionStatus = dataObject.status;
  if (envelope.command === "IOStatus" && dataObject) deviceSet[`io${dataObject.no}`] = dataObject.state;
  await db
    .collection(COLLECTIONS.devices)
    .updateOne({ sn }, { $set: deviceSet, $setOnInsert: { sn, firstSeenAt: new Date() } }, { upsert: true });

  // 3. 業務處理
  if (PLATE_RESULT_COMMANDS.has(envelope.command) && dataObject) {
    const outcome = await saveMqttPlateResult({ ...envelope, sn }, dataObject);
    if (outcome.duplicate) console.log(`[mqtt] ${envelope.command} guid 重複，略過: ${dataObject.guid}`);
  }

  if (isReply) return;

  // 4. 設備主動請求 → 平台自動回覆（沿用請求的 requestId，與原廠範例一致）
  const replyTo = (command: string, data: unknown) =>
    publishDownlink(state, buildEnvelope(sn, command, data, envelope.requestId), "auto-reply");

  switch (envelope.command) {
    case "Conn":
      await replyTo("Rtd", { serverTime: formatTime() });
      break;
    case "Image":
      await replyTo("Image", autoReplyData("Image"));
      break;
    case "DlPassRule":
      await replyTo("DlPassRule", autoReplyData("DlPassRule"));
      break;
    case "DlCarInfo":
      await replyTo("DlCarInfo", autoReplyData("DlCarInfo"));
      break;
  }
}

/** devInfo 格式：key~value,key~value */
function parseDevInfo(devInfo: string): Data {
  const result: Data = {};
  for (const pair of devInfo.split(",")) {
    const [key, ...rest] = pair.split("~");
    if (key) result[key.trim()] = rest.join("~").trim();
  }
  return result;
}
