import "server-only";
import {
  DEFAULT_DISPLAY_BOARD_SETTINGS,
  formatDisplayTime,
  renderDisplayText,
  type DisplayBoardSettings,
  type DisplayMessage,
} from "./display-board-shared";
import { getCapacity } from "./gate-capacity";
import { encodeLineMessage } from "./led-protocol";
import type { LedColor } from "./led-protocol-shared";
import { sendCommand } from "./mqtt-platform";
import { listCameras } from "./parking-entries";
import type { CameraRole } from "./parking-entry-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 顯示板情境訊息（設定存在 carpark.system_settings，_id: "display-board"）：
// - 有剩餘車位 / 無剩餘車位：固定顯示。每 10 秒和每次進出場後檢查一次，只重送內容（含 {車位數}）有變的行，
//   避免一直寫入控制卡（固定顯示會存進控制卡，斷電後保留）
//   {時間} 每分鐘變一次，所以有用到時間的行每分鐘會重送一次
// - 辨識到車輛：攝影機辨識到車牌時送臨時訊息，顯示幾秒後控制卡自動恢復固定顯示
// 顯示板接在攝影機的 RS485 上，訊息用 SerialData 轉送；離線的攝影機略過，上線後下次檢查再送。

const SETTINGS_ID = "display-board";
const SYNC_INTERVAL_MS = 10_000;
const SEND_TIMEOUT_MS = 3000;

type SettingsDoc = Omit<DisplayBoardSettings, "updatedAt"> & { _id: string; updatedAt: Date };

async function settingsCollection() {
  return (await getParkingDb()).collection<SettingsDoc>(COLLECTIONS.systemSettings);
}

export async function getDisplayBoardSettings(): Promise<DisplayBoardSettings> {
  const doc = await (await settingsCollection()).findOne({ _id: SETTINGS_ID });
  if (!doc) return DEFAULT_DISPLAY_BOARD_SETTINGS;
  const d = DEFAULT_DISPLAY_BOARD_SETTINGS;
  return {
    address: doc.address ?? d.address,
    boards: {
      entry: { ...d.boards.entry, ...doc.boards?.entry },
      exit: { ...d.boards.exit, ...doc.boards?.exit },
    },
    updatedAt: doc.updatedAt?.toISOString() ?? null,
  };
}

export async function saveDisplayBoardSettings(value: Omit<DisplayBoardSettings, "updatedAt">): Promise<DisplayBoardSettings> {
  await (await settingsCollection()).updateOne(
    { _id: SETTINGS_ID },
    { $set: { ...value, updatedAt: new Date() } },
    { upsert: true },
  );
  // 設定改了就重送固定顯示
  runtime().lastSent.clear();
  syncDisplayBoards().catch(report);
  return getDisplayBoardSettings();
}

// ---- 下發 ----

interface Runtime {
  timer: ReturnType<typeof setInterval> | null;
  /** 各攝影機每一行上次成功送出的固定顯示內容，相同就不重送 */
  lastSent: Map<string, (string | null)[]>;
  syncing: boolean;
  /** 同步進行中又被要求同步時，結束後再跑一次 */
  pending: boolean;
}

const globalForBoard = globalThis as typeof globalThis & { _displayBoard?: Runtime };
const runtime = (): Runtime =>
  (globalForBoard._displayBoard ??= { timer: null, lastSent: new Map(), syncing: false, pending: false });

const report = (error: unknown) =>
  console.error("[display-board]", error instanceof Error ? error.message : error);

/**
 * 依序送出各行，回傳每一行是否送成功（略過的行為 null）。
 * 固定顯示時空白行送一個空格，把舊內容蓋掉；skip 為 true 的行不送
 */
async function sendLines(
  sn: string,
  address: number,
  lines: string[],
  colors: LedColor[],
  durationSec?: number,
  skip: boolean[] = [],
): Promise<(boolean | null)[]> {
  const sent: (boolean | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    sent[i] = null;
    const text = lines[i].trim() ? lines[i] : durationSec ? "" : " ";
    if (!text || skip[i]) continue;
    const encoded = encodeLineMessage({ line: (i + 1) as 1 | 2 | 3 | 4, text, color: colors[i], durationSec, address });
    if (encoded.overLimit) {
      console.warn(`[display-board] ${sn} 第 ${i + 1} 行超過 ${encoded.contentBytes} bytes，略過：${text}`);
      continue;
    }
    sent[i] = false;
    try {
      const result = await sendCommand(
        sn,
        "SerialData",
        { serialData: [{ channel: 0, data: encoded.base64, len: encoded.frameBytes }] },
        SEND_TIMEOUT_MS,
      );
      sent[i] = result.status === "success" || result.status === "sent";
    } catch {
      // 送失敗，下次檢查再送
    }
  }
  return sent;
}

const render = (message: DisplayMessage, values: { spaces?: number; plate?: string }) =>
  message.lines.map((l) => renderDisplayText(l, { ...values, time: formatDisplayTime(new Date()) }));

/** 依剩餘車位數把各顯示板的固定顯示切到「有剩餘車位」或「無剩餘車位」，內容有變才送 */
export async function syncDisplayBoards(): Promise<void> {
  const rt = runtime();
  if (rt.syncing) {
    rt.pending = true;
    return;
  }
  rt.syncing = true;
  try {
    do {
      rt.pending = false;
      const [settings, capacity, cameras] = await Promise.all([getDisplayBoardSettings(), getCapacity(), listCameras()]);
      for (const camera of cameras) {
        // 只送給連上 MQTT 的攝影機（只用 HTTP 上傳的攝影機收不到命令）
        if (!camera.role || camera.online !== true) continue;
        const board = settings.boards[camera.role];
        const message = capacity.remaining > 0 ? board.available : board.full;
        if (!message.enabled) continue;
        const lines = render(message, { spaces: capacity.remaining });
        const keys = lines.map((text, i) => JSON.stringify([settings.address, text, message.colors[i]]));
        const last = rt.lastSent.get(camera.sn) ?? [];
        const unchanged = keys.map((k, i) => last[i] === k);
        if (unchanged.every(Boolean)) continue;
        const sent = await sendLines(camera.sn, settings.address, lines, message.colors, undefined, unchanged);
        rt.lastSent.set(
          camera.sn,
          keys.map((k, i) => (unchanged[i] || sent[i] ? k : null)),
        );
      }
    } while (rt.pending);
  } finally {
    rt.syncing = false;
  }
}

/** 進出場後呼叫：車位數變了，馬上更新固定顯示 */
export function requestDisplaySync(): void {
  syncDisplayBoards().catch(report);
}

/** 伺服器啟動時呼叫一次：定時檢查車位數並更新固定顯示 */
export function startDisplayBoardSync(): void {
  const rt = runtime();
  if (rt.timer) return;
  rt.timer = setInterval(requestDisplaySync, SYNC_INTERVAL_MS);
  requestDisplaySync();
}

/** 攝影機辨識到車牌：送「辨識到車輛時」的臨時訊息（不等送完） */
export function showVehicleDetected(sn: string, role: CameraRole, plate: string): void {
  (async () => {
    const settings = await getDisplayBoardSettings();
    const message = settings.boards[role].detected;
    if (!message.enabled) return;
    const { remaining } = await getCapacity();
    await sendLines(sn, settings.address, render(message, { plate, spaces: remaining }), message.colors, message.durationSec);
  })().catch(report);
}
