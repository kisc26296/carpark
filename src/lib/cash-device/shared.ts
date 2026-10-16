// 現金設備（紙鈔機、硬幣接收器、找零錢機 ×4）前後端共用的型別與常數，不可引用 server-only 模組

/** 找零錢機一台只出一種硬幣，共 4 台，各接一個 COM port */
export const HOPPER_DEVICES = ["hopper1", "hopper5", "hopper10", "hopper50"] as const;
export type HopperDeviceId = (typeof HOPPER_DEVICES)[number];

export const HOPPER_COIN_VALUES: Record<HopperDeviceId, number> = { hopper1: 1, hopper5: 5, hopper10: 10, hopper50: 50 };

export const CASH_DEVICES = ["bill", "coin", ...HOPPER_DEVICES] as const;
export type CashDeviceId = (typeof CASH_DEVICES)[number];

export const CASH_DEVICE_LABELS: Record<CashDeviceId, string> = {
  bill: "紙鈔機",
  coin: "硬幣接收器",
  hopper1: "找零錢機（1元）",
  hopper5: "找零錢機（5元）",
  hopper10: "找零錢機（10元）",
  hopper50: "找零錢機（50元）",
};

export const isCashDevice = (v: unknown): v is CashDeviceId =>
  typeof v === "string" && (CASH_DEVICES as readonly string[]).includes(v);

export const isHopperDevice = (v: unknown): v is HopperDeviceId =>
  typeof v === "string" && (HOPPER_DEVICES as readonly string[]).includes(v);

export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;
export const DATA_BITS = [5, 6, 7, 8] as const;
export const PARITIES = ["none", "even", "odd", "mark", "space"] as const;
export const STOP_BITS = [1, 1.5, 2] as const;

export type Parity = (typeof PARITIES)[number];

export interface SerialSettings {
  /** COM port 名稱，例如 COM3；空字串代表尚未設定 */
  port: string;
  baudRate: number;
  dataBits: (typeof DATA_BITS)[number];
  parity: Parity;
  stopBits: (typeof STOP_BITS)[number];
}

export interface CashDeviceConfig extends SerialSettings {
  device: CashDeviceId;
  /** 伺服器啟動時是否自動連線；按「連線」設為 true、按「中斷」設為 false */
  autoConnect: boolean;
  updatedAt: string | null;
}

export const DEFAULT_SERIAL_SETTINGS: Record<CashDeviceId, SerialSettings> = {
  // ICT 紙鈔機協定規定 9600 8E1
  bill: { port: "", baudRate: 9600, dataBits: 8, parity: "even", stopBits: 1 },
  // ICT 硬幣接收器 UCA RS232 協定規定 9600 8N1
  coin: { port: "", baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 },
  // ICT 出幣機 RED FLAG 協定，原廠測試工具預設 9600 E 8 1
  ...(Object.fromEntries(
    HOPPER_DEVICES.map((d) => [d, { port: "", baudRate: 9600, dataBits: 8, parity: "even", stopBits: 1 }]),
  ) as Record<HopperDeviceId, SerialSettings>),
};

// ---- ICT 紙鈔機（ICT104U Protocol） ----

/** 紙鈔種類 0x40 起算共 16 種；面額依原廠測試工具，第 5 種以後未定義面額 */
export const BILL_TYPES: { index: number; label: string; value: number | null }[] = Array.from(
  { length: 16 },
  (_, index) => {
    const value = [100, 200, 500, 1000][index] ?? null;
    return { index, label: value ? String(value) : `第${index + 1}種`, value };
  },
);

export interface BillSettings {
  /** 允許收的紙鈔種類（BILL_TYPES 的 index），未勾選的種類會自動退鈔 */
  enabledTypes: number[];
  /** true：收到紙鈔後等待操作人員按 Accept/Reject；false：自動收下 */
  escrow: boolean;
}

export const DEFAULT_BILL_SETTINGS: BillSettings = { enabledTypes: [0, 1, 2, 3], escrow: true };

export interface BillEscrow {
  typeIndex: number;
  value: number | null;
  since: string;
  /** 已送出 Escrow Hold（0x18），紙鈔會一直暫存直到 Accept/Reject */
  held: boolean;
  /** 已按下 Accept/Reject，等待紙鈔機回報收進或退出 */
  decision: "accept" | "reject" | null;
}

export interface BillAcceptorState {
  /** 最近幾秒內有收到紙鈔機的回應 */
  link: boolean;
  status: "unknown" | "enabled" | "inhibited";
  /** 最近一次回報的錯誤，收到 0x2F（錯誤解除）或正常狀態時清除 */
  error: string | null;
  escrow: BillEscrow | null;
  /** 收進鈔箱的張數（Clear Credit 歸零） */
  count: number;
  /** 收進鈔箱的金額（Clear Credit 歸零） */
  credit: number;
  /** 累計總金額（伺服器重啟前不歸零） */
  total: number;
  settings: BillSettings;
}

export type BillAction = "accept" | "reject" | "hold" | "enable" | "disable" | "reset" | "poll" | "clearCredit";

/** 原廠測試工具 Escrow 等待時間：超過 5 秒沒回應，紙鈔機會自行處理 */
export const BILL_ESCROW_TIMEOUT_MS = 5000;

// ---- ICT 出幣機（Mini Hopper RED FLAG Protocol SWD-10） ----

export const HOPPER_MODELS = ["MH", "EMH", "UCH"] as const;
export type HopperModel = (typeof HOPPER_MODELS)[number];

export interface HopperSettings {
  /** 出幣機位址 0～3（機台 DIP switch #1、#2） */
  address: number;
  /** 機型，決定狀態位元的意思 */
  model: HopperModel;
}

export const DEFAULT_HOPPER_SETTINGS: HopperSettings = { address: 0, model: "MH" };

export type HopperPayoutMode = "passive" | "active1" | "active2" | "empty";

export interface HopperPayout {
  mode: HopperPayoutMode;
  /** 要出的枚數；清空出幣機時為 null */
  requested: number | null;
  /** 主動回報模式下已收到的出幣通知次數 */
  dispensed: number;
  accepted: boolean;
  done: boolean;
  since: string;
}

export interface HopperState {
  /** 最近一次狀態回報的原始位元組 */
  statusByte: number | null;
  /** 狀態位元翻譯；空陣列代表正常 */
  statusFlags: string[];
  /** 最近一次回報的未出幣數 */
  remain: number | null;
  payout: HopperPayout | null;
  /** 最近一則重要訊息，例如「出幣完成」「拒絕出幣」 */
  lastMessage: string | null;
  /** 伺服器啟動後累計出幣枚數（主動回報模式才算得到） */
  totalDispensed: number;
  settings: HopperSettings;
}

export type HopperAction =
  | "payoutNoReply"
  | "payoutReply"
  | "payoutRemain"
  | "status"
  | "remain"
  | "reset"
  | "empty"
  | "stop";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface CashDeviceStatus {
  device: CashDeviceId;
  state: ConnectionState;
  /** 目前開啟（或嘗試開啟）的 COM port */
  port: string | null;
  error: string | null;
}

export interface SerialLogEntry {
  id: number;
  time: string;
  device: CashDeviceId;
  /** rx 設備送來、tx 平台送出、info 連線狀態等系統訊息 */
  dir: "rx" | "tx" | "info";
  hex: string;
  /** 解析後的說明；協定尚未實作時為空 */
  text?: string;
}

export interface ComPortInfo {
  path: string;
  friendlyName: string | null;
  manufacturer: string | null;
  /** 設定中使用這個 port 的設備 */
  usedBy: CashDeviceId | null;
}

export const toHex = (buf: Uint8Array): string =>
  Array.from(buf, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");

/** 解析使用者輸入的 HEX 字串（可含空白、逗號、0x 前綴），格式錯誤回傳 null */
export function parseHex(input: string): Uint8Array | null {
  const cleaned = input.replace(/0x/gi, "").replace(/[\s,]/g, "");
  if (!cleaned || cleaned.length % 2 !== 0 || /[^0-9a-f]/i.test(cleaned)) return null;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// ---- ICT 硬幣接收器（UCA RS232 Protocol 1.3.5） ----

/** 硬幣通道 1～16；面額依文件分類器範例（UCAES TWD：Coin 1～4 = 1、5、10、50 元），其餘未定義 */
export const COIN_CHANNELS: { channel: number; value: number | null }[] = Array.from({ length: 16 }, (_, i) => ({
  channel: i + 1,
  value: [1, 5, 10, 50][i] ?? null,
}));

/** 分類器出口 A～D（0～3） */
export const SORTER_OUTLETS = ["A", "B", "C", "D"] as const;

export interface CoinSettings {
  /** 允許收的硬幣通道（1～16），送「收幣通道設定」時使用 */
  enabledChannels: number[];
}

export const DEFAULT_COIN_SETTINGS: CoinSettings = {
  enabledChannels: COIN_CHANNELS.map((c) => c.channel),
};

export type CoinNormalStatus = "idling" | "accepting" | "disabled";

export interface CoinAcceptorState {
  /** 最近一段時間內有收到硬幣接收器的回應 */
  link: boolean;
  normal: CoinNormalStatus | null;
  /** 目前的錯誤：感測器 1～6 錯誤、釣魚、程式檢查碼錯誤；回到待機或停用時清除 */
  error: { kind: "sensor" | "fishing" | "checksum"; sensor: number | null; text: string } | null;
  lastCoin: { channel: number; value: number | null; at: string } | null;
  /** 其他狀態：最近一次收到 ACK / NAK / 無效封包 */
  other: { kind: "ack" | "nak" | "invalid"; at: string } | null;
  /** 收幣枚數與金額（金額歸零時清除） */
  count: number;
  amount: number;
  /** 伺服器啟動後累計金額 */
  total: number;
  version: { text: string; checksum: string } | null;
  info: { manufacturer: string; model: string; serial: string } | null;
  /** 分類器設定：Coin 1～8 各自的出口（0～3 = A～D） */
  sorter: number[] | null;
  settings: CoinSettings;
}

export type CoinAction =
  | "enable"
  | "disable"
  | "status"
  | "version"
  | "info"
  | "channels"
  | "sorterRead"
  | "sorterWrite"
  | "fishingOn"
  | "fishingOff"
  | "clearAmount";
