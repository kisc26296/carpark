import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { getKioskVideoSettings, videoContentType } from "@/lib/parking/kiosk-video";

export const dynamic = "force-dynamic";

// 繳費機播放的影片檔：GET /api/parking/kiosk-video/file
// 只讀「資料庫設定」裡指定的那個檔案，不接受外部傳入路徑；支援 Range，影片才能邊下載邊播、循環時不必整個重抓
export async function GET(request: Request) {
  const { filePath } = await getKioskVideoSettings();
  const type = filePath ? videoContentType(filePath) : null;
  if (!filePath || !type) return new Response("尚未設定影片檔", { status: 404 });

  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return new Response("找不到影片檔", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const stream = (start: number, end: number) =>
    Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    return new Response(size > 0 ? stream(0, size - 1) : null, { headers: { ...headers, "Content-Length": String(size) } });
  }

  // bytes=500-999、bytes=500-、bytes=-500（最後 500 bytes）
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (!range[1] && !range[2]) start = 0;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  return new Response(stream(start, end), {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}
