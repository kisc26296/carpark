// O1S / O2S 路外停車設備 MQTT 公共封包（前後端共用，不可引入 server-only 模組）

export const PROTOCOL_VERSION = "1.0.1";
export const DEFAULT_SN = "YCOPCM-E10-LS24090006";

export const uploadTopic = (clientId: string) => `upload/${clientId}`;
export const downloadTopic = (clientId: string) => `download/${clientId}`;

/** MQTT 公共封包；data 是業務 JSON 序列化後的字串，不是巢狀物件 */
export interface MqttEnvelope {
  command: string;
  data: string;
  requestId: string;
  sn: string;
  time: string;
  version: string;
}

/** Receipt 的共同 data */
export interface ReceiptData {
  errCode: number;
  errInfo: string;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** 文件格式 yyyy-MM-dd HH:mm:ss */
export function formatTime(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 圖片封裝時間 yyyyMMddHHmmss */
export function formatCompactTime(date: Date = new Date()): string {
  return formatTime(date).replace(/[-: ]/g, "");
}

let requestSeq = 0;

/** 產生 requestId：yyyyMMddHHmmss + 3 位流水號，與原廠範例長度一致 */
export function newRequestId(): string {
  requestSeq = (requestSeq + 1) % 1000;
  return formatCompactTime() + pad(requestSeq, 3);
}

/** 業務資料轉成封包用的字串；空物件或空值依原廠範例送空字串 */
export function serializeData(data: unknown): string {
  if (data === undefined || data === null || data === "") return "";
  if (typeof data === "string") return data;
  if (typeof data === "object" && Object.keys(data).length === 0) return "";
  return JSON.stringify(data);
}

export function buildEnvelope(
  sn: string,
  command: string,
  data: unknown,
  requestId: string = newRequestId(),
): MqttEnvelope {
  return {
    command,
    data: serializeData(data),
    requestId,
    sn,
    time: formatTime(),
    version: PROTOCOL_VERSION,
  };
}

/**
 * 解析收到的封包。原廠範例的 data 欄位有時寫成 Data，接收端兩者都接受。
 * 回傳 dataObject 為 data 字串再 parse 一次的結果；無法解析時保留原字串於 data。
 */
export function parseEnvelope(raw: string): {
  envelope: MqttEnvelope;
  dataObject: Record<string, unknown> | null;
} {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const rawData = obj.data ?? obj.Data ?? "";
  const data = typeof rawData === "string" ? rawData : JSON.stringify(rawData);

  let dataObject: Record<string, unknown> | null = null;
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") dataObject = parsed;
    } catch {
      dataObject = null;
    }
  }

  return {
    envelope: {
      command: String(obj.command ?? ""),
      data,
      requestId: String(obj.requestId ?? ""),
      sn: String(obj.sn ?? ""),
      time: String(obj.time ?? ""),
      version: String(obj.version ?? ""),
    },
    dataObject,
  };
}

/** 下行命令對應的上行回覆 command（未列出者回覆同名 command） */
export const REPLY_COMMAND: Record<string, string> = {
  SerialData: "SerialDataReply",
  Image: "ImageReply",
  Config: "ConfigReply",
  ClearData: "ClearDataReply",
  DlPassRule: "OverUpdate",
  DlCarInfo: "OverUpdate",
  QueryCarInfo: "CarInfo",
};

/** 設備不會回覆的下行命令 */
export const NO_REPLY_COMMANDS = new Set(["Rtd"]);

/** 車牌辨識類上行訊息，會寫入 plate_results */
export const PLATE_RESULT_COMMANDS = new Set([
  "Result",
  "OfflineResult",
  "BackResult",
  "CarRetention",
]);
