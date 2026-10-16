import "server-only";
import { SerialPort } from "serialport";
import { emitCashDeviceEvent } from "./events";
import { billAcceptorProtocol } from "./protocols/bill-acceptor";
import { coinAcceptorProtocol } from "./protocols/coin-acceptor";
import { createHopperProtocol } from "./protocols/hopper";
import type { DeviceProtocol, ProtocolContext } from "./protocols/types";
import {
  CASH_DEVICE_LABELS,
  CASH_DEVICES,
  HOPPER_DEVICES,
  toHex,
  type CashDeviceId,
  type CashDeviceStatus,
  type ConnectionState,
  type SerialLogEntry,
  type SerialSettings,
} from "./shared";

// 管理所有現金設備的 RS232 連線：每台設備同一時間只開一個 COM port，
// 由伺服器統一持有，多個瀏覽器同時觀看也不會互搶。
// 存在 globalThis，開發模式 HMR 重新載入模組時不會重複開 port。

const LOG_LIMIT = 500;
const RECONNECT_MS = 5000;
// 用「間隔超過 30ms 沒收到資料」當作一包的結尾，
// 避免同一包資料被 OS 拆成好幾段 data 事件、在畫面上碎成好幾行
const RX_IDLE_MS = 30;
// 連線測試等設備回應的時間
const TEST_TIMEOUT_MS = 1500;

// 每台設備的協定：解析收到的資料、自動回應、連線測試用的詢問指令
const PROTOCOLS: Record<CashDeviceId, DeviceProtocol> = {
  bill: billAcceptorProtocol,
  coin: coinAcceptorProtocol,
  ...(Object.fromEntries(HOPPER_DEVICES.map((d) => [d, createHopperProtocol(d)])) as Record<
    (typeof HOPPER_DEVICES)[number],
    DeviceProtocol
  >),
};

interface Slot {
  device: CashDeviceId;
  settings: SerialSettings | null;
  port: SerialPort | null;
  state: ConnectionState;
  error: string | null;
  /** 使用者希望維持連線；斷線時據此決定要不要自動重連 */
  wantOpen: boolean;
  /** 每次開啟/關閉都加一，讓還在進行中的舊開啟流程知道自己已過期 */
  generation: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  rxChunks: Buffer[];
  rxTimer: ReturnType<typeof setTimeout> | null;
  /** 最近一次收到資料、收到協定看得懂的回應的時間，連線測試用 */
  lastRxAt: number;
  lastValidRxAt: number;
  lastRxHex: string;
}

interface Manager {
  slots: Record<CashDeviceId, Slot>;
  logs: SerialLogEntry[];
  nextLogId: number;
}

const globalForSerial = globalThis as typeof globalThis & {
  _cashSerialManager?: Manager;
};

const createSlot = (device: CashDeviceId): Slot => ({
  device,
  settings: null,
  port: null,
  state: "disconnected",
  error: null,
  wantOpen: false,
  generation: 0,
  reconnectTimer: null,
  rxChunks: [],
  rxTimer: null,
  lastRxAt: 0,
  lastValidRxAt: 0,
  lastRxHex: "",
});

function getManager(): Manager {
  globalForSerial._cashSerialManager ??= {
    slots: {} as Record<CashDeviceId, Slot>,
    logs: [],
    nextLogId: 1,
  };
  const manager = globalForSerial._cashSerialManager;
  // 設備清單改過（例如找零錢機從 1 台變 4 台）時，補上新設備的 slot
  for (const device of CASH_DEVICES) manager.slots[device] ??= createSlot(device);
  return manager;
}

const describe = (s: SerialSettings) => `${s.port} ${s.baudRate} ${s.dataBits}${s.parity[0].toUpperCase()}${s.stopBits}`;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function addLog(device: CashDeviceId, dir: SerialLogEntry["dir"], hex: string, text?: string): void {
  const manager = getManager();
  const entry: SerialLogEntry = { id: manager.nextLogId++, time: new Date().toISOString(), device, dir, hex, text };
  manager.logs.push(entry);
  if (manager.logs.length > LOG_LIMIT) manager.logs.splice(0, manager.logs.length - LOG_LIMIT);
  emitCashDeviceEvent({ type: "log", entry });
}

const statusOf = (slot: Slot): CashDeviceStatus => ({
  device: slot.device,
  state: slot.state,
  port: slot.settings?.port || null,
  error: slot.error,
});

function setState(slot: Slot, state: ConnectionState, error: string | null): void {
  slot.state = state;
  slot.error = error;
  emitCashDeviceEvent({ type: "status", status: statusOf(slot) });
}

function flushRx(slot: Slot): void {
  if (slot.rxTimer) clearTimeout(slot.rxTimer);
  slot.rxTimer = null;
  if (slot.rxChunks.length === 0) return;
  const data = Buffer.concat(slot.rxChunks);
  slot.rxChunks = [];
  const result = PROTOCOLS[slot.device].onData(data);
  slot.lastRxAt = Date.now();
  slot.lastRxHex = toHex(data);
  if (result.valid) slot.lastValidRxAt = slot.lastRxAt;
  if (result.entries) {
    for (const entry of result.entries) if (!entry.quiet) addLog(slot.device, "rx", toHex(entry.data), entry.text);
  } else if (!result.quiet) {
    addLog(slot.device, "rx", toHex(data), result.text || undefined);
  }
  // 先記下收到的資料再自動回應，紀錄的先後順序才會跟實際一致
  for (const reply of result.replies ?? []) {
    writeDevice(slot.device, reply.data, reply.text, { quiet: reply.quiet }).catch((error) =>
      addLog(slot.device, "info", "", `自動回應失敗：${errorMessage(error)}`),
    );
  }
}

function onData(slot: Slot, chunk: Buffer): void {
  slot.rxChunks.push(chunk);
  if (slot.rxTimer) clearTimeout(slot.rxTimer);
  slot.rxTimer = setTimeout(() => flushRx(slot), RX_IDLE_MS);
}

function clearReconnect(slot: Slot): void {
  if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
  slot.reconnectTimer = null;
}

function scheduleReconnect(slot: Slot): void {
  clearReconnect(slot);
  const generation = slot.generation;
  slot.reconnectTimer = setTimeout(async () => {
    slot.reconnectTimer = null;
    if (!slot.wantOpen || slot.generation !== generation) return;
    try {
      await openPort(slot);
    } catch (error) {
      if (slot.generation !== generation) return;
      setState(slot, "reconnecting", errorMessage(error));
      scheduleReconnect(slot);
    }
  }, RECONNECT_MS);
}

async function openPort(slot: Slot): Promise<void> {
  const settings = slot.settings!;
  const generation = slot.generation;
  setState(slot, "connecting", null);

  const port = await new Promise<SerialPort>((resolve, reject) => {
    try {
      const p = new SerialPort({
        path: settings.port,
        baudRate: settings.baudRate,
        dataBits: settings.dataBits,
        parity: settings.parity,
        stopBits: settings.stopBits,
        autoOpen: false,
      });
      p.open((err) => (err ? reject(err) : resolve(p)));
    } catch (error) {
      reject(error);
    }
  });

  // 開啟期間使用者已經按了中斷或改連別的 port，把剛開好的關掉
  if (slot.generation !== generation) {
    port.close();
    return;
  }

  slot.port = port;
  port.on("data", (chunk: Buffer) => onData(slot, chunk));
  port.on("error", (err) => addLog(slot.device, "info", "", `錯誤：${err.message}`));
  port.on("close", () => {
    if (slot.port !== port) return;
    slot.port = null;
    flushRx(slot);
    PROTOCOLS[slot.device]?.onClose();
    if (slot.wantOpen) {
      addLog(slot.device, "info", "", `連線中斷，${RECONNECT_MS / 1000} 秒後自動重連`);
      setState(slot, "reconnecting", "連線中斷");
      scheduleReconnect(slot);
    }
  });

  addLog(slot.device, "info", "", `已連線 ${describe(settings)}`);
  setState(slot, "connected", null);

  const ctx: ProtocolContext = {
    write: (message) => writeDevice(slot.device, message.data, message.text, { quiet: message.quiet }),
  };
  PROTOCOLS[slot.device]?.onOpen(ctx);
}

async function closePort(slot: Slot): Promise<void> {
  clearReconnect(slot);
  flushRx(slot);
  const port = slot.port;
  slot.port = null;
  if (port) PROTOCOLS[slot.device]?.onClose();
  if (port?.isOpen) {
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

/**
 * 開啟設備連線。retry 為 true 時（伺服器啟動自動連線）開不起來會每 5 秒重試；
 * 為 false 時（使用者手動按連線）直接回報錯誤，不在背景一直重試。
 */
export async function openDevice(
  device: CashDeviceId,
  settings: SerialSettings,
  { retry = false }: { retry?: boolean } = {},
): Promise<CashDeviceStatus> {
  if (!settings.port) throw new Error(`${CASH_DEVICE_LABELS[device]}尚未設定 COM port`);

  const manager = getManager();
  const conflict = CASH_DEVICES.find(
    (d) =>
      d !== device &&
      manager.slots[d].wantOpen &&
      manager.slots[d].settings?.port.toUpperCase() === settings.port.toUpperCase(),
  );
  if (conflict) throw new Error(`${settings.port} 已被${CASH_DEVICE_LABELS[conflict]}使用中`);

  const slot = manager.slots[device];
  slot.generation++;
  await closePort(slot);
  slot.settings = settings;
  slot.wantOpen = true;

  try {
    await openPort(slot);
  } catch (error) {
    const message = errorMessage(error);
    addLog(device, "info", "", `開啟 ${settings.port} 失敗：${message}`);
    if (retry) {
      setState(slot, "reconnecting", message);
      scheduleReconnect(slot);
    } else {
      slot.wantOpen = false;
      setState(slot, "disconnected", message);
      throw new Error(`開啟 ${settings.port} 失敗：${message}`);
    }
  }
  return statusOf(slot);
}

export async function closeDevice(device: CashDeviceId): Promise<CashDeviceStatus> {
  const slot = getManager().slots[device];
  const wasActive = slot.wantOpen || slot.port !== null;
  slot.generation++;
  slot.wantOpen = false;
  await closePort(slot);
  if (wasActive) addLog(device, "info", "", "已中斷連線");
  setState(slot, "disconnected", null);
  return statusOf(slot);
}

export async function writeDevice(
  device: CashDeviceId,
  data: Uint8Array,
  text?: string,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
  const port = getManager().slots[device].port;
  if (!port?.isOpen) throw new Error(`${CASH_DEVICE_LABELS[device]}尚未連線`);
  await new Promise<void>((resolve, reject) => {
    port.write(Buffer.from(data), (err) => {
      if (err) return reject(err);
      port.drain((drainErr) => (drainErr ? reject(drainErr) : resolve()));
    });
  });
  if (!quiet) addLog(device, "tx", toHex(data), text);
}

export function getStatuses(): CashDeviceStatus[] {
  const { slots } = getManager();
  return CASH_DEVICES.map((d) => statusOf(slots[d]));
}

export function getLogs(): SerialLogEntry[] {
  return [...getManager().logs];
}

/** 列出主機上的 COM port */
export async function listComPorts(): Promise<{ path: string; friendlyName: string | null; manufacturer: string | null }[]> {
  const ports = await SerialPort.list();
  return ports
    .map((p) => ({
      path: p.path,
      friendlyName: (p as { friendlyName?: string }).friendlyName ?? null,
      manufacturer: p.manufacturer ?? null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export interface DeviceTestResult {
  ok: boolean;
  message: string;
  /** 設備回應的原始資料 */
  responseHex: string | null;
}

/**
 * 連線測試：用設定的 COM port 送出詢問狀態指令，等設備回應。
 * 原本沒連線的設備會暫時開啟、測完關閉，不改變自動連線設定；原本就連著的直接用現有連線測。
 */
export async function testDevice(device: CashDeviceId, settings: SerialSettings): Promise<DeviceTestResult> {
  const label = CASH_DEVICE_LABELS[device];
  if (!settings.port) return { ok: false, message: `${label}尚未設定 COM port`, responseHex: null };

  const slot = getManager().slots[device];
  const alreadyOpen = slot.state === "connected" && slot.settings?.port === settings.port;
  if (!alreadyOpen) {
    const previous = { settings: slot.settings, state: slot.state, error: slot.error };
    try {
      await openDevice(device, settings);
    } catch (error) {
      // 測試失敗不該讓設備顯示成連線失敗，還原測試前的狀態
      slot.settings = previous.settings;
      setState(slot, previous.state, previous.error);
      return { ok: false, message: errorMessage(error), responseHex: null };
    }
  }

  try {
    const probe = PROTOCOLS[device].probe();
    const sentAt = Date.now();
    await writeDevice(device, probe.data, probe.text);
    // 等到收到看得懂的回應，或逾時
    while (Date.now() - sentAt < TEST_TIMEOUT_MS && slot.lastValidRxAt < sentAt) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (slot.lastValidRxAt >= sentAt) {
      return { ok: true, message: `${settings.port} 連線正常，${label}有回應`, responseHex: slot.lastRxHex };
    }
    if (slot.lastRxAt >= sentAt) {
      return {
        ok: false,
        message: `${settings.port} 有收到資料但不是${label}的回應，請確認接的設備或通訊參數（鮑率、同位元）`,
        responseHex: slot.lastRxHex,
      };
    }
    return {
      ok: false,
      message: `${settings.port} 已開啟，但 ${TEST_TIMEOUT_MS / 1000} 秒內${label}沒有回應，請確認設備電源與接線`,
      responseHex: null,
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error), responseHex: null };
  } finally {
    if (!alreadyOpen) await closeDevice(device);
  }
}
