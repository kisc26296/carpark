import "server-only";
import { getCoinSettings, saveCoinSettings } from "../config-store";
import { emitCashDeviceEvent } from "../events";
import {
  COIN_CHANNELS,
  DEFAULT_COIN_SETTINGS,
  type CoinAcceptorState,
  type CoinAction,
  type CoinSettings,
} from "../shared";
import type { DeviceProtocol, ProtocolContext, RxResult } from "./types";

// ICT 硬幣接收器 UCA RS232 協定（v1.3.5，9600 8N1）。
// 封包：SYNC(90) + LNG(整包長度) + CMD + DATA(0~250) + EXT(03) + CHECKSUM(SYNC~EXT 相加取低 8 位元)。
// 文件規定每 200~300ms 輪詢一次，這裡每 250ms 送「詢問狀態」，也用來判斷通訊是否正常；
// 收幣訊息（12）由硬幣接收器主動送出，收到就累計枚數與金額。

const SYNC = 0x90;
const EXT = 0x03;

const CMD = {
  enable: 0x01,
  disable: 0x02,
  version: 0x03,
  status: 0x11,
  info: 0x5b,
  channels: 0x90,
  sorterWrite: 0x91,
  sorterRead: 0x92,
  fishingOn: 0xf0,
  fishingOff: 0xf1,
} as const;

const POLL_MS = 250;
const LINK_TIMEOUT_MS = 1500;
// 封包收到一半超過這個時間沒收完就捨棄
const RX_TIMEOUT_MS = 200;
// 收到硬幣後「收幣中」至少亮 1 秒，不然下一次輪詢回待機馬上就蓋掉，畫面上看不到
const ACCEPTING_HOLD_MS = 1000;

const SENSORS: Record<number, { sensor: number; name: string }> = {
  1: { sensor: 1, name: "線圈 1" },
  2: { sensor: 2, name: "線圈 2" },
  3: { sensor: 3, name: "投幣口 2" },
  4: { sensor: 4, name: "投幣口 1" },
  5: { sensor: 5, name: "退幣口" },
  6: { sensor: 6, name: "紅外線感測器" },
  7: { sensor: 6, name: "條碼感測器" },
};

const COMMAND_TEXT: Record<number, string> = {
  [CMD.enable]: "啟用收幣",
  [CMD.disable]: "停用收幣",
  [CMD.channels]: "收幣通道設定",
  [CMD.sorterWrite]: "分類器設定",
  [CMD.fishingOn]: "啟用釣魚進階回報",
  [CMD.fishingOff]: "停用釣魚進階回報",
  [CMD.version]: "詢問版本",
  [CMD.info]: "詢問製造商資訊",
  [CMD.sorterRead]: "讀取分類器設定",
};

interface Runtime {
  state: CoinAcceptorState;
  ctx: ProtocolContext | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  buf: number[];
  lastByteAt: number;
  lastRxAt: number;
  acceptingAt: number;
  /** 最後送出的非輪詢指令，用來說明 ACK / NAK 是回應哪個指令 */
  lastCommand: number | null;
  settingsLoaded: Promise<void> | null;
}

const globalForCoin = globalThis as typeof globalThis & {
  _coinAcceptorRuntime?: Runtime;
};

function getRuntime(): Runtime {
  if (!globalForCoin._coinAcceptorRuntime) {
    globalForCoin._coinAcceptorRuntime = {
      state: {
        link: false,
        normal: null,
        error: null,
        lastCoin: null,
        other: null,
        count: 0,
        amount: 0,
        total: 0,
        version: null,
        info: null,
        sorter: null,
        settings: DEFAULT_COIN_SETTINGS,
      },
      ctx: null,
      pollTimer: null,
      buf: [],
      lastByteAt: 0,
      lastRxAt: 0,
      acceptingAt: 0,
      lastCommand: null,
      settingsLoaded: null,
    };
  }
  return globalForCoin._coinAcceptorRuntime;
}

const hex = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();
const sum = (bytes: ArrayLike<number>, end: number) => {
  let s = 0;
  for (let i = 0; i < end; i++) s += bytes[i];
  return s & 0xff;
};
const ascii = (bytes: number[]) => String.fromCharCode(...bytes).trim();

/** 組出主機送給硬幣接收器的封包 */
export function buildCoinPacket(command: number, data: number[] = []): Uint8Array {
  const packet = [SYNC, data.length + 5, command, ...data, EXT];
  return Uint8Array.from([...packet, sum(packet, packet.length)]);
}

/** 收幣通道設定的 2 個資料位元組：DATA0 bit7~0 = 通道 1~8，DATA1 bit7~0 = 通道 9~16，1 = 收、0 = 不收 */
export function channelBytes(enabled: number[]): [number, number] {
  let mask = 0;
  for (const ch of enabled) if (ch >= 1 && ch <= 16) mask |= 1 << (16 - ch);
  return [(mask >> 8) & 0xff, mask & 0xff];
}

function emit(): void {
  emitCashDeviceEvent({ type: "coin", state: structuredClone(getRuntime().state) });
}

function ensureSettings(): Promise<void> {
  const rt = getRuntime();
  if (!rt.settingsLoaded) {
    const loading: Promise<void> = getCoinSettings()
      .then((settings) => {
        if (rt.settingsLoaded !== loading) return;
        rt.state.settings = settings;
        emit();
      })
      .catch((error) => {
        if (rt.settingsLoaded === loading) rt.settingsLoaded = null;
        console.error("[coin] 讀取硬幣接收器設定失敗:", error instanceof Error ? error.message : error);
      });
    rt.settingsLoaded = loading;
  }
  return rt.settingsLoaded;
}

function poll(): void {
  const rt = getRuntime();
  if (!rt.ctx) return;
  const link = Date.now() - rt.lastRxAt < LINK_TIMEOUT_MS;
  if (link !== rt.state.link) {
    rt.state.link = link;
    if (!link) rt.state.normal = null;
    emit();
  }
  rt.ctx.write({ data: buildCoinPacket(CMD.status), text: "詢問狀態", quiet: true }).catch(() => {});
}

/** 解讀一個格式與檢查碼都正確的封包，回傳說明；例行輪詢回應（狀態沒變）標記 quiet */
function handlePacket(command: number, data: number[]): { text: string; quiet: boolean } {
  const rt = getRuntime();
  const { state } = rt;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const lastText = rt.lastCommand !== null ? COMMAND_TEXT[rt.lastCommand] : null;

  switch (command) {
    case 0x50:
      state.other = { kind: "ack", at };
      return { text: `ACK${lastText ? `：${lastText}成功` : ""}`, quiet: false };
    case 0x4b:
      state.other = { kind: "nak", at };
      return { text: `NAK${lastText ? `：${lastText}被拒絕` : "：指令被拒絕"}`, quiet: false };
    case 0x11:
    case 0x14: {
      const normal = command === 0x11 ? "idling" : "disabled";
      const changed = state.normal !== normal || state.error !== null;
      state.error = null;
      // 剛收到硬幣時保留「收幣中」一小段時間
      if (!(normal === "idling" && state.normal === "accepting" && now - rt.acceptingAt < ACCEPTING_HOLD_MS)) {
        state.normal = normal;
      }
      return { text: normal === "idling" ? "待機中" : "停用中", quiet: !changed };
    }
    case 0x12: {
      const channel = data[0] ?? 0;
      const value = COIN_CHANNELS[channel - 1]?.value ?? null;
      state.normal = "accepting";
      rt.acceptingAt = now;
      state.lastCoin = { channel, value, at };
      state.count += 1;
      state.amount += value ?? 0;
      state.total += value ?? 0;
      return { text: `收到硬幣：通道 ${channel}${value ? `（${value} 元）` : "（未定義面額）"}`, quiet: false };
    }
    case 0x16: {
      const sensor = SENSORS[data[0]];
      const text = sensor ? `感測器 ${sensor.sensor} 錯誤（${sensor.name}）` : `感測器錯誤（代碼 ${hex(data[0] ?? 0)}）`;
      const quiet = state.error?.text === text;
      state.error = { kind: "sensor", sensor: sensor?.sensor ?? null, text };
      return { text, quiet };
    }
    case 0x17: {
      const text = data.length ? `釣魚（拉線盜幣），通道 ${data[0]}` : "釣魚（拉線盜幣）";
      const quiet = state.error?.text === text;
      state.error = { kind: "fishing", sensor: null, text };
      return { text, quiet };
    }
    case 0x18: {
      const text = "程式檢查碼錯誤";
      const quiet = state.error?.text === text;
      state.error = { kind: "checksum", sensor: null, text };
      return { text, quiet };
    }
    case 0x13:
    case 0x15:
    case 0x19:
      return { text: `保留狀態 0x${hex(command)}`, quiet: false };
    case 0x03: {
      // 20 個 ASCII 字元的版本字串 + 2 bytes 程式檢查碼（高位在前）
      const text = ascii(data.slice(0, -2));
      const checksum = data.length >= 2 ? `${hex(data.at(-2)!)}${hex(data.at(-1)!)}` : "";
      state.version = { text, checksum };
      return { text: `版本：${text}，程式檢查碼 ${checksum}`, quiet: false };
    }
    case 0x5b: {
      const manufacturer = ascii(data.slice(0, 6));
      const model = ascii(data.slice(6, 12));
      const serial = ascii(data.slice(12));
      state.info = { manufacturer, model, serial };
      return { text: `製造商 ${manufacturer}，型號 ${model}，序號 ${serial}`, quiet: false };
    }
    case 0x92: {
      state.sorter = data.slice(0, 8);
      const text = state.sorter.map((o, i) => `硬幣 ${i + 1}→${"ABCD"[o] ?? hex(o)}`).join("、");
      return { text: `分類器設定：${text}`, quiet: false };
    }
    default:
      return { text: `未定義的回應 0x${hex(command)}`, quiet: false };
  }
}

function onData(data: Uint8Array): RxResult {
  const rt = getRuntime();
  const now = Date.now();
  const before = JSON.stringify(rt.state);
  const entries: NonNullable<RxResult["entries"]> = [];
  let valid = false;

  rt.lastRxAt = now;
  rt.state.link = true;

  const invalid = (bytes: number[], text: string) => {
    rt.state.other = { kind: "invalid", at: new Date(now).toISOString() };
    entries.push({ data: Uint8Array.from(bytes), text });
  };

  if (rt.buf.length > 0 && now - rt.lastByteAt > RX_TIMEOUT_MS) {
    invalid(rt.buf, "封包不完整，已捨棄");
    rt.buf = [];
  }
  rt.lastByteAt = now;

  let garbage: number[] = [];
  const flushGarbage = () => {
    if (garbage.length === 0) return;
    invalid(garbage, "無法辨識的資料，已捨棄");
    garbage = [];
  };

  for (const b of data) {
    if (rt.buf.length === 0 && b !== SYNC) {
      garbage.push(b);
      continue;
    }
    // 長度至少 5（沒有 DATA 的封包）
    if (rt.buf.length === 1 && b < 5) {
      garbage.push(...rt.buf, b);
      rt.buf = [];
      continue;
    }
    flushGarbage();
    rt.buf.push(b);
    if (rt.buf.length < 2 || rt.buf.length < rt.buf[1]) continue;

    const packet = rt.buf;
    rt.buf = [];
    const length = packet[1];
    if (packet[length - 2] !== EXT) {
      invalid(packet, "結尾碼不是 03，已捨棄");
    } else if (sum(packet, length - 1) !== packet[length - 1]) {
      invalid(packet, `檢查碼錯誤（應為 ${hex(sum(packet, length - 1))}），已捨棄`);
    } else {
      const { text, quiet } = handlePacket(packet[2], packet.slice(3, length - 2));
      entries.push({ data: Uint8Array.from(packet), text, quiet });
      valid = true;
    }
  }
  flushGarbage();

  if (JSON.stringify(rt.state) !== before) emit();
  return { entries, valid };
}

export const coinAcceptorProtocol: DeviceProtocol = {
  onOpen(ctx) {
    const rt = getRuntime();
    rt.ctx = ctx;
    rt.buf = [];
    rt.lastRxAt = 0;
    rt.lastCommand = null;
    rt.state.link = false;
    rt.state.normal = null;
    rt.state.error = null;
    ensureSettings();
    if (rt.pollTimer) clearInterval(rt.pollTimer);
    rt.pollTimer = setInterval(poll, POLL_MS);
    emit();
    poll();
  },
  onClose() {
    const rt = getRuntime();
    rt.ctx = null;
    if (rt.pollTimer) clearInterval(rt.pollTimer);
    rt.pollTimer = null;
    rt.buf = [];
    rt.state.link = false;
    rt.state.normal = null;
    emit();
  },
  onData,
  probe: () => ({ data: buildCoinPacket(CMD.status), text: "連線測試：詢問狀態" }),
};

export async function getCoinState(): Promise<CoinAcceptorState> {
  await ensureSettings();
  return structuredClone(getRuntime().state);
}

/** 執行測試工具上的按鈕功能；sorterWrite 需要 sorter（硬幣 1～8 各自的出口 0～3） */
export async function runCoinAction(action: CoinAction, sorter?: number[]): Promise<CoinAcceptorState> {
  const rt = getRuntime();

  if (action === "clearAmount") {
    rt.state.count = 0;
    rt.state.amount = 0;
    emit();
    return structuredClone(rt.state);
  }
  if (!rt.ctx) throw new Error("硬幣接收器尚未連線");

  let packet: Uint8Array;
  let text: string;
  switch (action) {
    case "status":
      packet = buildCoinPacket(CMD.status);
      text = "詢問狀態";
      break;
    case "channels": {
      const enabled = rt.state.settings.enabledChannels;
      packet = buildCoinPacket(CMD.channels, channelBytes(enabled));
      text = `收幣通道設定：${enabled.length ? `收通道 ${enabled.join("、")}` : "全部不收"}`;
      break;
    }
    case "sorterWrite": {
      if (!sorter || sorter.length !== 8 || sorter.some((o) => !Number.isInteger(o) || o < 0 || o > 3)) {
        throw new Error("分類器設定需要硬幣 1～8 各自的出口（A～D）");
      }
      packet = buildCoinPacket(CMD.sorterWrite, sorter);
      text = `分類器設定：${sorter.map((o, i) => `硬幣 ${i + 1}→${"ABCD"[o]}`).join("、")}`;
      break;
    }
    case "fishingOn":
    case "fishingOff":
      packet = buildCoinPacket(action === "fishingOn" ? CMD.fishingOn : CMD.fishingOff, [0x00]);
      text = COMMAND_TEXT[action === "fishingOn" ? CMD.fishingOn : CMD.fishingOff];
      break;
    default: {
      const command = CMD[action];
      packet = buildCoinPacket(command);
      text = COMMAND_TEXT[command];
    }
  }

  // 先記住指令再送出，避免回應比 write 完成還早到時對不上
  const previousCommand = rt.lastCommand;
  rt.lastCommand = packet[2];
  try {
    await rt.ctx.write({ data: packet, text });
  } catch (error) {
    rt.lastCommand = previousCommand;
    throw error;
  }
  return structuredClone(rt.state);
}

export async function updateCoinSettings(settings: CoinSettings): Promise<CoinAcceptorState> {
  const rt = getRuntime();
  await saveCoinSettings(settings);
  // 已經手動存過設定，就不要讓還在讀取中的舊設定蓋回來
  rt.settingsLoaded = Promise.resolve();
  rt.state.settings = settings;
  emit();
  return structuredClone(rt.state);
}
