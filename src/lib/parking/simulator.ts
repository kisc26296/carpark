import "server-only";
import { randomUUID } from "node:crypto";
import net from "node:net";
import mqtt, { type MqttClient } from "mqtt";
import { getBrokerUrl } from "./mqtt-platform";
import {
  PLATE_RESULT_COMMANDS,
  buildEnvelope,
  downloadTopic,
  formatCompactTime,
  formatTime,
  newRequestId,
  parseEnvelope,
  uploadTopic,
  type MqttEnvelope,
} from "./protocol";

// 模擬 O1S/O2S 設備：透過真的 MQTT Broker 收下行命令並依規格回覆，
// 讓沒有實體設備時也能測試平台端的完整流程。

type Data = Record<string, unknown>;

/** 原廠預設加密 key 123456798 的 Base64 */
const DEFAULT_KEY = "MTIzNDU2Nzk4";

/** 模擬「設備搜尋」帳號密碼登入雛形協定（見 device-login.ts）的測試帳密 */
const MOCK_LOGIN_USERNAME = "admin";
const MOCK_LOGIN_PASSWORD = "admin";

interface DeviceState {
  gate: "open" | "closed";
  longOpen: boolean;
  enableReply: boolean;
  encryption: { enabled: boolean; key: string };
  carInfo: Record<string, { type: number; time: string }>;
  io: [number, number];
  serialConfig: Data;
  imageType: number;
}

export interface SimulatorInfo {
  sn: string;
  connected: boolean;
  state: DeviceState;
  /** 模擬「設備搜尋」帳密登入雛形協定監聽的 TCP port；帳密固定 admin/admin */
  loginPort: number;
}

class SimulatedDevice {
  readonly client: MqttClient;
  readonly state: DeviceState = {
    gate: "closed",
    longOpen: false,
    enableReply: true,
    encryption: { enabled: false, key: DEFAULT_KEY },
    carInfo: {},
    io: [0, 0],
    serialConfig: { channel: 0, baudRate: 19200, parity: 0, stop: 1, databits: 8 },
    imageType: 0,
  };
  private readonly ready: Promise<void>;
  private readonly loginServer: net.Server;
  private readonly loginReady: Promise<void>;

  constructor(readonly sn: string) {
    this.client = mqtt.connect(getBrokerUrl(), {
      clientId: `sim-${sn}`,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 5000,
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("模擬設備連線 Broker 逾時")), 5000);
      this.client.once("connect", () => {
        clearTimeout(timer);
        this.client.subscribe(downloadTopic(sn), { qos: 1 }, (err) => (err ? reject(err) : resolve()));
      });
    });
    this.client.on("message", (_topic, payload) => {
      this.onDownlink(payload.toString("utf8")).catch((err) => console.error(`[sim ${sn}] 處理失敗:`, err));
    });
    this.client.on("error", (err) => console.error(`[sim ${sn}] 連線錯誤:`, err.message));

    // 模擬「設備搜尋」的帳密登入雛形協定：NDJSON，{action:"login",username,password} -> {ok,sn,...}
    this.loginServer = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) return;
        const line = buffer.slice(0, newlineIndex);
        let req: Record<string, unknown> = {};
        try {
          req = JSON.parse(line);
        } catch {
          socket.end(JSON.stringify({ ok: false, error: "請求格式錯誤（非 JSON）" }) + "\n");
          return;
        }
        if (req.action === "login" && req.username === MOCK_LOGIN_USERNAME && req.password === MOCK_LOGIN_PASSWORD) {
          socket.end(JSON.stringify({ ok: true, sn: this.sn, deviceType: "SIMULATOR", firmwareVer: "sim-1.0" }) + "\n");
        } else {
          socket.end(JSON.stringify({ ok: false, error: "帳號或密碼錯誤" }) + "\n");
        }
      });
    });
    this.loginReady = new Promise((resolve) => this.loginServer.listen(0, "0.0.0.0", resolve));
  }

  get loginPort(): number {
    const addr = this.loginServer.address();
    return addr && typeof addr === "object" ? addr.port : 0;
  }

  async waitReady() {
    await Promise.all([this.ready, this.loginReady]);
  }

  async publish(command: string, data: unknown, requestId?: string): Promise<MqttEnvelope> {
    await this.ready;
    const envelope = buildEnvelope(this.sn, command, data, requestId ?? newRequestId());
    // Result 依規格使用 QoS 2，其餘 QoS 1
    const qos = command === "Result" ? 2 : 1;
    await new Promise<void>((resolve, reject) => {
      this.client.publish(uploadTopic(this.sn), JSON.stringify(envelope), { qos }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    return envelope;
  }

  /** 測試頁送出的上行訊息：辨識結果類自動補 guid / 時間 */
  async publishUplink(command: string, data: Data | null): Promise<MqttEnvelope> {
    const payload = data ? { ...data } : null;
    if (payload && PLATE_RESULT_COMMANDS.has(command)) {
      if ("guid" in payload && !payload.guid) payload.guid = randomUUID();
      if ("triggT" in payload && !payload.triggT) payload.triggT = formatTime();
      if ("imgT" in payload && !payload.imgT) payload.imgT = formatCompactTime();
    }
    return this.publish(command, payload);
  }

  private receipt(command: string, requestId: string, errCode = 0, errInfo = "") {
    // EnableReply 關閉時，errCode 類 Receipt 不回
    if (!this.state.enableReply) return Promise.resolve();
    return this.publish(command, { errCode, errInfo }, requestId).then(() => undefined);
  }

  private async onDownlink(raw: string) {
    const { envelope, dataObject } = parseEnvelope(raw);
    const data = dataObject ?? {};
    const { command, requestId } = envelope;
    const s = this.state;

    switch (command) {
      case "Open":
        s.gate = "open";
        return this.receipt("Open", requestId);
      case "Close":
        if (s.longOpen) return this.receipt("Close", requestId, 1, "LongOpen is on");
        s.gate = "closed";
        return this.receipt("Close", requestId);
      case "LongOpen":
        s.longOpen = data.switchType === "on";
        if (s.longOpen) s.gate = "open";
        return this.receipt("LongOpen", requestId);
      case "Image":
        s.imageType = Number(data.type ?? 0);
        return this.receipt("ImageReply", requestId);
      case "EnableReply":
        // 先回 Receipt 再套用，確保關閉時平台仍收到這次的結果
        await this.receipt("EnableReply", requestId);
        s.enableReply = Number(data.enable) === 1;
        return;
      case "Config":
        if ("enableReply" in data) s.enableReply = Number(data.enableReply) === 1;
        return this.receipt("ConfigReply", requestId);
      case "EnableUpdate":
        await this.receipt("EnableUpdate", requestId);
        // 收到全量更新通知後，按需向平台索取規則/名單
        if (Number(data.passruler) === 1) await this.publish("DlPassRule", "");
        if (Number(data.carinfo) === 1) await this.publish("DlCarInfo", "");
        return;
      case "DlPassRule":
        await this.publish("OverUpdate", { passruler: 1, carinfo: 0 }, requestId);
        return;
      case "DlCarInfo":
        // 模擬設備不實際下載檔案，只回報已更新
        await this.publish("OverUpdate", { passruler: 0, carinfo: 1 }, requestId);
        return;
      case "AddCarInfo": {
        const list = Array.isArray(data.carInfoList) ? (data.carInfoList as Data[]) : [];
        if (list.length === 0) return this.receipt("AddCarInfo", requestId, 1, "carInfoList is empty");
        for (const car of list) {
          s.carInfo[String(car.plate)] = { type: Number(car.type), time: String(car.time ?? "") };
        }
        return this.receipt("AddCarInfo", requestId);
      }
      case "DeleteCarInfo": {
        const plates = Array.isArray(data.plateList) ? (data.plateList as string[]) : [];
        for (const plate of plates) delete s.carInfo[plate];
        return this.receipt("DeleteCarInfo", requestId);
      }
      case "QueryCarInfo": {
        const plate = String(data.plate ?? "");
        const car = s.carInfo[plate];
        // 規格未定義查無資料時的回覆，這裡回 type 0、time 空字串
        await this.publish(
          "CarInfo",
          { plate, queryId: String(data.queryId ?? ""), time: car?.time ?? "", type: car?.type ?? 0 },
          requestId,
        );
        return;
      }
      case "SnapshotPic":
        await this.publish(
          "SnapshotPic",
          {
            snapshotId: String(data.snapshotId ?? ""),
            picN: `bbbb/${this.sn}/${formatCompactTime().slice(0, 8)}/snapshot.jpg`,
            picN_full: `https://example/${this.sn}/snapshot.jpg`,
            picNFile: "",
          },
          requestId,
        );
        return;
      case "SerialConfig":
        s.serialConfig = { ...s.serialConfig, ...data };
        await this.publish("SerialConfig", { channel: Number(data.channel ?? 0), state: 0 }, requestId);
        return;
      case "SerialData":
        return this.receipt("SerialDataReply", requestId);
      case "IOStatus": {
        const no = Number(data.no ?? 0) === 1 ? 1 : 0;
        await this.publish("IOStatus", { no, state: s.io[no] }, requestId);
        return;
      }
      case "SoftTriggerCapture":
        await this.receipt("SoftTriggerCapture", requestId);
        // 軟觸發後設備另外輸出 Result（新的 requestId）
        setTimeout(() => {
          this.publishUplink("Result", {
            IsCarExist: "Motor Vehicle",
            carNO: "SIM-0001",
            carNOC: "",
            confid: 900,
            coordinate: "(18,85,32,94)",
            encrypted: s.encryption.enabled ? "Encrypted" : "Unencrypted",
            fwConfid: 850,
            guid: "",
            imgT: "",
            openGate: 0,
            resultType: 2,
            triggT: "",
            validPlate: "TRUE",
          }).catch((err) => console.error(`[sim ${this.sn}] 軟觸發 Result 失敗:`, err));
        }, 300);
        return;
      case "ResetDevice":
        await this.receipt("ResetDevice", requestId);
        // 模擬重啟：重新上線並送出 Conn
        setTimeout(() => {
          s.gate = "closed";
          s.longOpen = false;
          this.sendConn().catch((err) => console.error(`[sim ${this.sn}] 重啟後 Conn 失敗:`, err));
        }, 1000);
        return;
      case "EncryptionStatus":
        await this.publish("EncryptionStatus", { status: s.encryption.enabled ? 1 : 0 }, requestId);
        return;
      case "EncryptDevice": {
        const ok = typeof data.key === "string" && data.key.length > 0;
        if (ok) {
          s.encryption = { enabled: Number(data.enable) === 1, key: String(data.key) };
        }
        await this.publish("EncryptDevice", { status: ok ? 0 : 1 }, requestId);
        return;
      }
      case "ChangeEncryptionKey": {
        const ok = data.currentKey === s.encryption.key && typeof data.newKey === "string" && data.newKey;
        if (ok) s.encryption.key = String(data.newKey);
        await this.publish("ChangeEncryptionKey", { status: ok ? 0 : 1 }, requestId);
        return;
      }
      case "ClearData":
        if (Number(data.clearCarInfo) === 1) s.carInfo = {};
        return this.receipt("ClearDataReply", requestId);
      case "Rtd":
        // 平台心跳/時間，設備不回覆
        return;
      default:
        console.warn(`[sim ${this.sn}] 未支援的下行命令: ${command}`);
    }
  }

  sendConn() {
    return this.publish("Conn", {
      devInfo:
        "devIP~127.0.0.1,devSubnet~255.255.255.0,devGateway~127.0.0.1,appVer~sim-1.0,firmwareVer~sim-1.0,deviceType~SIMULATOR",
    });
  }

  async stop() {
    await this.client.endAsync();
    await new Promise<void>((resolve) => this.loginServer.close(() => resolve()));
  }

  info(): SimulatorInfo {
    return { sn: this.sn, connected: this.client.connected, state: this.state, loginPort: this.loginPort };
  }
}

const globalForSim = globalThis as typeof globalThis & {
  _parkingSimulators?: Map<string, SimulatedDevice>;
};

function registry(): Map<string, SimulatedDevice> {
  globalForSim._parkingSimulators ??= new Map();
  return globalForSim._parkingSimulators;
}

/** 啟動模擬設備；已啟動則直接回傳 */
export async function startSimulator(sn: string): Promise<SimulatorInfo> {
  let device = registry().get(sn);
  if (!device) {
    device = new SimulatedDevice(sn);
    registry().set(sn, device);
    try {
      await device.waitReady();
    } catch (error) {
      registry().delete(sn);
      await device.stop().catch(() => undefined);
      throw error;
    }
    // 設備上線後先送 Conn（規格 6.1）
    await device.sendConn();
  }
  return device.info();
}

export async function stopSimulator(sn: string): Promise<boolean> {
  const device = registry().get(sn);
  if (!device) return false;
  registry().delete(sn);
  await device.stop();
  return true;
}

export function getSimulator(sn: string) {
  return registry().get(sn);
}

export function listSimulators(): SimulatorInfo[] {
  return [...registry().values()].map((d) => d.info());
}
