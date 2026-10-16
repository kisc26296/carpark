import "server-only";
import { getHopperSettings, saveHopperSettings } from "../config-store";
import { emitCashDeviceEvent } from "../events";
import {
  CASH_DEVICE_LABELS,
  DEFAULT_HOPPER_SETTINGS,
  type HopperDeviceId,
  type HopperAction,
  type HopperModel,
  type HopperPayoutMode,
  type HopperSettings,
  type HopperState,
} from "../shared";
import type { DeviceProtocol, ProtocolContext, RxResult } from "./types";

// ICT 出幣機 RED FLAG 協定（Mini Hopper RED FLAG Communication Protocol SWD-10）。
// 封包固定 6 bytes：Header(05) + 方向(主機→出幣機 10 / 出幣機→主機 01) + 位址(00~03) + 指令 + 資料 + 檢查碼，
// 檢查碼 = 前 5 個 byte 相加取低 8 位元。收到的 AA 回應要看前一個指令才知道意思
// （接受出幣 / 未出幣數 / 接受清空 / 已停止），所以記住最後送出的指令。

const HEADER = 0x05;
const HOST = 0x10;
const SLAVE = 0x01;

const CMD = {
  payoutPassive: 0x10,
  status: 0x11,
  reset: 0x12,
  remain: 0x13,
  payoutActive1: 0x14,
  empty: 0x15,
  stop: 0x17,
  payoutActive2: 0x18,
} as const;

const PAYOUT_COMMANDS: Record<number, HopperPayoutMode> = {
  [CMD.payoutPassive]: "passive",
  [CMD.payoutActive1]: "active1",
  [CMD.payoutActive2]: "active2",
  [CMD.empty]: "empty",
};

// 文件建議接收逾時 200ms：封包收到一半超過這個時間沒收完就捨棄
const RX_TIMEOUT_MS = 200;

const STATUS_BITS: Record<HopperModel, (string | null)[]> = {
  MH: ["馬達有問題", "硬幣存量低於低水位（仍可出幣）", "結束出幣後仍偵測到出幣訊號", "稜鏡電眼異常", "推桿電眼異常", "開機程序進行中", null, null],
  EMH: ["馬達有問題", "硬幣存量低於低水位（仍可出幣）", "結束出幣後仍偵測到出幣訊號", "稜鏡電眼異常", "推桿電眼異常", "出幣進行中", null, null],
  UCH: ["馬達有問題", "硬幣存量低於低水位（仍可出幣）", "外部暫存記憶體異常", "電眼異常", "輸入電壓異常", "忙碌中（開機或出幣中）", "硬幣存量低於高水位", "硬幣存量低於低水位"],
};

const MODE_TEXT: Record<HopperPayoutMode, string> = {
  passive: "不回報",
  active1: "逐枚回報",
  active2: "回報剩餘數",
  empty: "清空",
};

interface Runtime {
  state: HopperState;
  ctx: ProtocolContext | null;
  /** 還沒收完的封包 */
  buf: number[];
  lastByteAt: number;
  lastCommand: number | null;
  settingsLoaded: Promise<void> | null;
}

// 4 台找零錢機（1、5、10、50 元）各自一份狀態，互不影響
const globalForHopper = globalThis as typeof globalThis & {
  _hopperRuntimes?: Map<HopperDeviceId, Runtime>;
};

function getRuntime(device: HopperDeviceId): Runtime {
  globalForHopper._hopperRuntimes ??= new Map();
  const runtimes = globalForHopper._hopperRuntimes;
  if (!runtimes.has(device)) {
    runtimes.set(device, {
      state: {
        statusByte: null,
        statusFlags: [],
        remain: null,
        payout: null,
        lastMessage: null,
        totalDispensed: 0,
        settings: DEFAULT_HOPPER_SETTINGS,
      },
      ctx: null,
      buf: [],
      lastByteAt: 0,
      lastCommand: null,
      settingsLoaded: null,
    });
  }
  return runtimes.get(device)!;
}

const hex = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();

const checksum = (bytes: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += bytes[i];
  return sum & 0xff;
};

/** 組出主機送給出幣機的封包 */
export function buildHopperPacket(address: number, command: number, data: number): Uint8Array {
  const packet = Uint8Array.of(HEADER, HOST, address, command, data, 0);
  packet[5] = checksum(packet);
  return packet;
}

export function hopperStatusFlags(model: HopperModel, status: number): string[] {
  return STATUS_BITS[model].flatMap((text, bit) => ((status >> bit) & 1 ? [text ?? `保留位元 ${bit}`] : []));
}

function emit(device: HopperDeviceId): void {
  emitCashDeviceEvent({ type: "hopper", device, state: structuredClone(getRuntime(device).state) });
}

function ensureSettings(device: HopperDeviceId): Promise<void> {
  const rt = getRuntime(device);
  if (!rt.settingsLoaded) {
    const loading: Promise<void> = getHopperSettings(device)
      .then((settings) => {
        if (rt.settingsLoaded !== loading) return;
        rt.state.settings = settings;
        emit(device);
      })
      .catch((error) => {
        if (rt.settingsLoaded === loading) rt.settingsLoaded = null;
        console.error("[hopper] 讀取出幣機設定失敗:", error instanceof Error ? error.message : error);
      });
    rt.settingsLoaded = loading;
  }
  return rt.settingsLoaded;
}

/** 解讀一個檢查碼正確的封包，更新狀態並回傳說明 */
function handlePacket(device: HopperDeviceId, packet: number[]): string {
  const rt = getRuntime(device);
  const { state } = rt;
  const [, , address, command, data] = packet;
  const note = address === state.settings.address ? "" : `（位址 ${hex(address)} 與設定的 ${hex(state.settings.address)} 不同）`;
  const payout = state.payout;
  let text: string;

  switch (command) {
    case 0x04: {
      state.statusByte = data;
      state.statusFlags = hopperStatusFlags(state.settings.model, data);
      text = data === 0 ? "狀態正常" : `狀態：${state.statusFlags.join("、")}`;
      break;
    }
    case 0xaa: {
      const last = rt.lastCommand;
      if (last === CMD.remain) {
        state.remain = data;
        text = `未出幣數 ${data} 枚`;
        // 不回報模式只能靠詢問未出幣數得知進度，剩 0 枚就算完成
        if (payout?.mode === "passive" && payout.accepted && !payout.done && data === 0) {
          payout.done = true;
          state.lastMessage = `出幣完成，共 ${payout.requested} 枚`;
          text += "，出幣完成";
        }
      } else if (last === CMD.stop) {
        if (payout) payout.done = true;
        text = "已停止出幣";
        state.lastMessage = text;
      } else if (last === CMD.empty) {
        if (payout) payout.accepted = true;
        text = "接受清空出幣機";
        state.lastMessage = text;
      } else if (last !== null && last in PAYOUT_COMMANDS) {
        if (payout) payout.accepted = true;
        state.remain = data;
        text = `接受出幣 ${data} 枚`;
        state.lastMessage = text;
      } else {
        text = `接受（資料 ${data}）`;
      }
      break;
    }
    case 0xbb: {
      state.remain = data;
      if (payout) payout.done = true;
      text = `拒絕出幣（忙碌中或異常），剩餘未出幣數 ${data} 枚`;
      state.lastMessage = text;
      break;
    }
    case 0x07: {
      state.totalDispensed += 1;
      if (payout) payout.dispensed += 1;
      const count = payout ? `，本次第 ${payout.dispensed} 枚` : "";
      if (payout?.mode === "active2") {
        state.remain = data;
        text = `出幣 1 枚，剩餘 ${data} 枚${count}`;
      } else {
        text = `出幣 1 枚${count}`;
      }
      break;
    }
    case 0x08: {
      if (payout) payout.done = true;
      if (payout?.mode !== "empty") state.remain = 0;
      text = payout ? `出幣完成，共 ${payout.dispensed} 枚` : "出幣完成";
      state.lastMessage = text;
      break;
    }
    default:
      text = `未定義的回應 0x${hex(command)}（資料 ${data}）`;
  }
  return text + note;
}

function onData(device: HopperDeviceId, data: Uint8Array): RxResult {
  const rt = getRuntime(device);
  const now = Date.now();
  const before = JSON.stringify(rt.state);
  const entries: RxResult["entries"] = [];
  let valid = false;

  // 上一個封包收到一半就斷了，捨棄
  if (rt.buf.length > 0 && now - rt.lastByteAt > RX_TIMEOUT_MS) {
    entries.push({ data: Uint8Array.from(rt.buf), text: "封包不完整，已捨棄" });
    rt.buf = [];
  }
  rt.lastByteAt = now;

  let garbage: number[] = [];
  const flushGarbage = () => {
    if (garbage.length === 0) return;
    entries.push({ data: Uint8Array.from(garbage), text: "無法辨識的資料，已捨棄" });
    garbage = [];
  };

  for (const b of data) {
    // 依文件逐 byte 檢查：開頭必須是 05、第二個 byte 必須是 01（出幣機→主機）
    if (rt.buf.length === 0 && b !== HEADER) {
      garbage.push(b);
      continue;
    }
    if (rt.buf.length === 1 && b !== SLAVE) {
      garbage.push(...rt.buf, b);
      rt.buf = [];
      continue;
    }
    flushGarbage();
    rt.buf.push(b);
    if (rt.buf.length < 6) continue;

    const packet = rt.buf;
    rt.buf = [];
    const ok = checksum(packet) === packet[5];
    if (ok) valid = true;
    entries.push({
      data: Uint8Array.from(packet),
      text: ok ? handlePacket(device, packet) : `檢查碼錯誤（應為 ${hex(checksum(packet))}），已捨棄`,
    });
  }
  flushGarbage();

  if (JSON.stringify(rt.state) !== before) emit(device);
  return { entries, valid };
}

/** 建立某一台找零錢機的協定處理 */
export function createHopperProtocol(device: HopperDeviceId): DeviceProtocol {
  return {
    onOpen(ctx) {
      const rt = getRuntime(device);
      rt.ctx = ctx;
      rt.buf = [];
      rt.lastCommand = null;
      emit(device);
      // 連線後先詢問一次狀態，文件也建議出幣前先確認出幣機狀態
      ensureSettings(device).then(() => runHopperAction(device, "status").catch(() => {}));
    },
    onClose() {
      const rt = getRuntime(device);
      rt.ctx = null;
      rt.buf = [];
      emit(device);
    },
    onData: (data) => onData(device, data),
    probe: () => {
      const rt = getRuntime(device);
      rt.lastCommand = CMD.status;
      return { data: buildHopperPacket(rt.state.settings.address, CMD.status, 0), text: "連線測試：詢問狀態" };
    },
  };
}

export async function getHopperState(device: HopperDeviceId): Promise<HopperState> {
  await ensureSettings(device);
  return structuredClone(getRuntime(device).state);
}

const ACTION_COMMANDS: Record<HopperAction, number> = {
  payoutNoReply: CMD.payoutPassive,
  payoutReply: CMD.payoutActive1,
  payoutRemain: CMD.payoutActive2,
  status: CMD.status,
  remain: CMD.remain,
  reset: CMD.reset,
  empty: CMD.empty,
  stop: CMD.stop,
};

/** 執行原廠測試工具上的按鈕功能；出幣類指令需要 count（1～255） */
export async function runHopperAction(
  device: HopperDeviceId,
  action: HopperAction,
  count?: number,
): Promise<HopperState> {
  const rt = getRuntime(device);
  if (!rt.ctx) throw new Error(`${CASH_DEVICE_LABELS[device]}尚未連線`);

  const command = ACTION_COMMANDS[action];
  const mode = PAYOUT_COMMANDS[command];
  const isCountedPayout = mode !== undefined && mode !== "empty";
  if (isCountedPayout && !(Number.isInteger(count) && count! >= 1 && count! <= 255)) {
    throw new Error("出幣枚數必須是 1～255 的整數");
  }

  const data = isCountedPayout ? count! : 0;
  const text = {
    payoutNoReply: `出幣 ${data} 枚（不回報）`,
    payoutReply: `出幣 ${data} 枚（逐枚回報）`,
    payoutRemain: `出幣 ${data} 枚（回報剩餘數）`,
    status: "詢問狀態",
    remain: "詢問未出幣數",
    reset: "重置出幣機",
    empty: "清空出幣機",
    stop: "緊急停止",
  }[action];

  // 先記住指令再送出，避免回應比 write 完成還早到時對不上
  const previousCommand = rt.lastCommand;
  rt.lastCommand = command;
  try {
    await rt.ctx.write({ data: buildHopperPacket(rt.state.settings.address, command, data), text });
  } catch (error) {
    rt.lastCommand = previousCommand;
    throw error;
  }

  if (mode) {
    rt.state.payout = {
      mode,
      requested: isCountedPayout ? data : null,
      dispensed: 0,
      accepted: false,
      done: false,
      since: new Date().toISOString(),
    };
    rt.state.lastMessage = `已送出${mode === "empty" ? "清空出幣機" : `出幣 ${data} 枚（${MODE_TEXT[mode]}）`}`;
  } else if (action === "reset") {
    rt.state.payout = null;
    rt.state.lastMessage = "已送出重置，出幣機重新開機最長約 10 秒";
  }

  emit(device);
  return structuredClone(rt.state);
}

export async function updateHopperSettings(device: HopperDeviceId, settings: HopperSettings): Promise<HopperState> {
  const rt = getRuntime(device);
  await saveHopperSettings(device, settings);
  // 已經手動存過設定，就不要讓還在讀取中的舊設定蓋回來
  rt.settingsLoaded = Promise.resolve();
  rt.state.settings = settings;
  if (rt.state.statusByte !== null) rt.state.statusFlags = hopperStatusFlags(settings.model, rt.state.statusByte);
  emit(device);
  return structuredClone(rt.state);
}
