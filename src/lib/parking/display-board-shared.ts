// 顯示板情境訊息：前後端共用的型別、預設值與文字替換，不可引用 server-only 模組

import { LED_DEFAULT_ADDRESS, LED_MAX_CONTENT_BYTES, type LedColor } from "./led-protocol-shared";
import type { CameraRole } from "./parking-entry-shared";

export const LED_LINE_COUNT = 4;

/** 訊息中可插入的變數，送出時換成實際值 */
export const DISPLAY_TAGS = {
  spaces: { tag: "{車位數}", label: "車位數", sample: "18" },
  plate: { tag: "{車號}", label: "車號", sample: "ABC1234" },
  time: { tag: "{時間}", label: "目前時間", sample: "14:35" },
} as const;
export type DisplayTag = keyof typeof DISPLAY_TAGS;

export type DisplayScenario = "available" | "full" | "detected";

export const DISPLAY_SCENARIOS: { id: DisplayScenario; label: string; hint: string; tags: DisplayTag[] }[] = [
  { id: "available", label: "有剩餘車位時", hint: "固定顯示；剩餘車位數大於 0 時", tags: ["spaces", "time"] },
  { id: "full", label: "無剩餘車位時", hint: "固定顯示；剩餘車位數為 0 時", tags: ["spaces", "time"] },
  { id: "detected", label: "辨識到車輛時", hint: "臨時訊息；攝影機辨識到車牌時，顯示幾秒後恢復固定顯示", tags: ["plate", "spaces", "time"] },
];

export interface DisplayMessage {
  enabled: boolean;
  lines: string[];
  colors: LedColor[];
}

export interface BoardMessages {
  available: DisplayMessage;
  full: DisplayMessage;
  /** 辨識到車輛時的臨時訊息，顯示 durationSec 秒 */
  detected: DisplayMessage & { durationSec: number };
}

export interface DisplayBoardSettings {
  /** 顯示控制卡地址 */
  address: number;
  boards: Record<CameraRole, BoardMessages>;
  updatedAt: string | null;
}

const message = (lines: string[], colors: LedColor[], enabled = true): DisplayMessage => ({ enabled, lines, colors });

export const DEFAULT_DISPLAY_BOARD_SETTINGS: DisplayBoardSettings = {
  address: LED_DEFAULT_ADDRESS,
  boards: {
    entry: {
      available: message(["歡迎光臨", "剩餘車位 {車位數}", "", ""], [2, 3, 1, 1], false),
      full: message(["車位已滿", "暫停進場", "", ""], [1, 1, 1, 1], false),
      detected: { ...message(["{車號}", "歡迎光臨", "", ""], [3, 2, 1, 1], false), durationSec: 10 },
    },
    exit: {
      available: message(["謝謝光臨", "", "", ""], [2, 1, 1, 1], false),
      full: message(["謝謝光臨", "", "", ""], [2, 1, 1, 1], false),
      detected: { ...message(["{車號}", "一路順風", "", ""], [3, 2, 1, 1], false), durationSec: 10 },
    },
  },
  updatedAt: null,
};

/** {時間} 的格式：HH:mm（24 小時制） */
export const formatDisplayTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

/** 顯示板用 GBK 編碼：英數 1 byte，中文與全形字 2 bytes */
export const gbkLength = (text: string) => [...text].reduce((n, c) => n + (c.charCodeAt(0) < 0x80 ? 1 : 2), 0);

/** 把訊息中的 {車位數}、{車號} 換成實際值；沒給的變數換成空字串 */
export function renderDisplayText(text: string, values: Partial<Record<DisplayTag, string | number>>): string {
  let out = text;
  for (const [key, { tag }] of Object.entries(DISPLAY_TAGS) as [DisplayTag, (typeof DISPLAY_TAGS)[DisplayTag]][]) {
    out = out.replaceAll(tag, values[key] === undefined ? "" : String(values[key]));
  }
  return out;
}

/** 用範例值檢查字數（車位數 4 位、車號 8 字元、時間 5 字元都算進去，避免實際送出時超過） */
const WORST_CASE = { spaces: "9999", plate: "ABCD1234", time: "23:59" };

function parseMessage(raw: unknown, label: string, errors: string[], fallback: DisplayMessage): DisplayMessage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(r.lines) ? r.lines : [];
  const rawColors = Array.isArray(r.colors) ? r.colors : [];
  const lines = Array.from({ length: LED_LINE_COUNT }, (_, i) => (typeof rawLines[i] === "string" ? rawLines[i].slice(0, 80) : ""));
  const colors = Array.from({ length: LED_LINE_COUNT }, (_, i) =>
    [1, 2, 3].includes(Number(rawColors[i])) ? (Number(rawColors[i]) as LedColor) : fallback.colors[i],
  );
  lines.forEach((line, i) => {
    if (gbkLength(renderDisplayText(line, WORST_CASE)) > LED_MAX_CONTENT_BYTES) {
      errors.push(`${label}第 ${i + 1} 行太長（含變數最多 ${LED_MAX_CONTENT_BYTES} bytes）`);
    }
  });
  const enabled = r.enabled === true;
  if (enabled && lines.every((l) => !l.trim())) errors.push(`${label}已啟用但沒有內容`);
  return { enabled, lines, colors };
}

/** 檢查並整理頁面送來的設定 */
export function validateDisplayBoardSettings(
  raw: unknown,
): { ok: true; value: Omit<DisplayBoardSettings, "updatedAt"> } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const address = Number(r.address ?? LED_DEFAULT_ADDRESS);
  if (!Number.isInteger(address) || address < 0 || address > 255) errors.push("顯示板地址必須是 0～255 的整數");
  const rawBoards = (r.boards ?? {}) as Record<string, Record<string, unknown>>;
  const boards = {} as Record<CameraRole, BoardMessages>;
  for (const role of ["entry", "exit"] as const) {
    const b = rawBoards[role] ?? {};
    const defaults = DEFAULT_DISPLAY_BOARD_SETTINGS.boards[role];
    const prefix = role === "entry" ? "入口" : "出口";
    const label = (s: DisplayScenario) => `${prefix}「${DISPLAY_SCENARIOS.find((x) => x.id === s)!.label}」`;
    const durationSec = Number((b.detected as Record<string, unknown> | undefined)?.durationSec ?? 10);
    if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 255) {
      errors.push(`${label("detected")}的顯示秒數必須是 1～255`);
    }
    boards[role] = {
      available: parseMessage(b.available, label("available"), errors, defaults.available),
      full: parseMessage(b.full, label("full"), errors, defaults.full),
      detected: { ...parseMessage(b.detected, label("detected"), errors, defaults.detected), durationSec },
    };
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { address, boards } };
}
