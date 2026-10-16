import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { getCaptureDir } from "./capture-settings";
import type { CameraRole } from "./parking-entry-shared";

/** Windows 檔名不能用的字元，以及開頭結尾空白/句點 */
function sanitizeForFilename(s: string, fallback: string): string {
  const cleaned = s
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "");
  return cleaned || fallback;
}

/** 辨識結果的 triggT／time 多半是 "yyyy-MM-dd HH:mm:ss"，轉成檔名用的 MMddHHmm（不含年、秒）；格式不對就用現在時間 */
function formatTimeForFilename(time: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const m = /(\d{4})\D+(\d{2})\D+(\d{2})\D+(\d{2})\D+(\d{2})\D+(\d{2})/.exec(time);
  if (m) {
    const [, , month, day, hour, minute] = m;
    return `${month}${day}${hour}${minute}`;
  }
  const now = new Date();
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** base64 可能帶 data:image/jpeg;base64, 前綴，去掉它 */
function stripDataUrlPrefix(base64: string): string {
  const comma = base64.indexOf(",");
  return base64.startsWith("data:") && comma !== -1 ? base64.slice(comma + 1) : base64;
}

async function uniqueFilePath(dir: string, baseName: string, ext: string): Promise<string> {
  let candidate = path.join(dir, `${baseName}${ext}`);
  let n = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${baseName}_${n}${ext}`);
      n += 1;
    } catch {
      return candidate;
    }
  }
}

export interface SaveCaptureInput {
  /** 觸發/辨識時間，原廠格式 yyyy-MM-dd HH:mm:ss */
  time: string;
  /** 車牌（未辨識出來時可能是 "Unlicensed" 或空字串） */
  plate: string;
  /** 拍到這張圖的攝影機是入口或出口，決定存到哪個資料夾 */
  role?: CameraRole | null;
  /** JPEG 圖片的 Base64（可能含 data: 前綴） */
  base64: string;
}

/**
 * 把辨識圖片存到設定的本機資料夾，檔名規則：{時間}_{車號}.jpg（時間在前，方便依檔名排序）。
 * 沒設定資料夾、沒有圖片內容時直接略過，回傳 null（不是錯誤，是「不需要存」）。
 */
export async function saveCaptureImage(input: SaveCaptureInput): Promise<string | null> {
  const dir = await getCaptureDir(input.role);
  if (!dir) return null;

  const base64 = stripDataUrlPrefix(input.base64 || "");
  if (!base64) return null;

  const timePart = formatTimeForFilename(input.time || "");
  const platePart = sanitizeForFilename(input.plate || "", "UNKNOWN");
  const baseName = `${timePart}_${platePart}`;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0) return null;

  await fs.mkdir(dir, { recursive: true });
  const filePath = await uniqueFilePath(dir, baseName, ".jpg");
  await fs.writeFile(filePath, buffer);
  return filePath;
}
