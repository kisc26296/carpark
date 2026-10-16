import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import {
  VIDEO_EXTENSIONS,
  youtubeEmbedUrl,
  youtubeId,
  type KioskVideoPlayer,
  type KioskVideoSettings,
  type KioskVideoSource,
} from "./kiosk-video-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 繳費機下方廣告影片設定，存在 carpark.system_settings（_id: "kiosk-video"）。
// 影片檔在伺服器主機上，由 /api/parking/kiosk-video/file 讀出來給繳費機播放（只讀設定裡的那個檔案）；
// 網路連結直接給繳費機播放。還沒設定過時播放 public/ads/parking-ad.mp4。

const SETTINGS_ID = "kiosk-video";
const DEFAULT_SRC = "/ads/parking-ad.mp4";

export class KioskVideoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Doc = Omit<KioskVideoSettings, "updatedAt"> & { _id: string; updatedAt?: Date };

async function collection() {
  const db = await getParkingDb();
  return db.collection<Doc>(COLLECTIONS.systemSettings);
}

export async function getKioskVideoSettings(): Promise<KioskVideoSettings> {
  const doc = await (await collection()).findOne({ _id: SETTINGS_ID });
  return {
    source: doc?.source === "url" ? "url" : "file",
    filePath: doc?.filePath ?? null,
    url: doc?.url ?? null,
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

export const videoContentType = (filePath: string) => VIDEO_EXTENSIONS[path.extname(filePath).toLowerCase()] ?? null;

async function isFile(filePath: string | null): Promise<boolean> {
  if (!filePath) return false;
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** 設定加上檔案是否存在、繳費機要播的內容 */
export async function getKioskVideo(): Promise<KioskVideoSettings & { fileExists: boolean; player: KioskVideoPlayer }> {
  const settings = await getKioskVideoSettings();
  const fileExists = await isFile(settings.filePath);
  let player: KioskVideoPlayer;
  if (settings.source === "url" && settings.url) {
    const id = youtubeId(settings.url);
    player = id ? { type: "youtube", src: youtubeEmbedUrl(id) } : { type: "video", src: settings.url };
  } else if (settings.source === "file" && settings.filePath) {
    // 加上設定時間，換了檔案時瀏覽器不會拿到舊的快取
    player = fileExists
      ? { type: "video", src: `/api/parking/kiosk-video/file?v=${encodeURIComponent(settings.updatedAt ?? "")}` }
      : null;
  } else {
    player = { type: "video", src: DEFAULT_SRC };
  }
  return { ...settings, fileExists, player };
}

export async function saveKioskVideoSettings(input: {
  source?: unknown;
  filePath?: unknown;
  url?: unknown;
}): Promise<KioskVideoSettings> {
  const source: KioskVideoSource = input.source === "url" ? "url" : "file";
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  let filePath = text(input.filePath);
  const url = text(input.url);

  if (filePath) {
    filePath = path.resolve(filePath);
    if (!(await isFile(filePath))) throw new KioskVideoError("找不到這個影片檔", 400);
    if (!videoContentType(filePath)) {
      throw new KioskVideoError(`影片格式必須是 ${Object.keys(VIDEO_EXTENSIONS).join("、")}`, 400);
    }
  }
  if (url && !/^https?:\/\//i.test(url)) throw new KioskVideoError("網路連結必須以 http:// 或 https:// 開頭", 400);
  if (source === "file" && !filePath) throw new KioskVideoError("請選擇影片檔", 400);
  if (source === "url" && !url) throw new KioskVideoError("請輸入網路連結", 400);

  await (await collection()).updateOne(
    { _id: SETTINGS_ID },
    { $set: { source, filePath, url, updatedAt: new Date() } },
    { upsert: true },
  );
  return getKioskVideoSettings();
}
