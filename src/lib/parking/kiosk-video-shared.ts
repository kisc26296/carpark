// 繳費機廣告影片設定：前後端共用的型別與工具，不可引用 server-only 模組

/** file：播放伺服器主機上的影片檔；url：播放網路連結 */
export type KioskVideoSource = "file" | "url";

export interface KioskVideoSettings {
  source: KioskVideoSource;
  /** 伺服器主機上的影片檔完整路徑 */
  filePath: string | null;
  /** 網路影片連結（mp4 等影片檔網址或 YouTube 連結） */
  url: string | null;
  updatedAt: string | null;
}

/** 繳費機實際要播的內容：video 用 <video> 播放，youtube 用內嵌播放器 */
export type KioskVideoPlayer = { type: "video"; src: string } | { type: "youtube"; src: string } | null;

/** 瀏覽器 <video> 能播的影片副檔名 */
export const VIDEO_EXTENSIONS: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
  ".mov": "video/quicktime",
};

/** 從 YouTube 連結取出影片 id（watch?v=、youtu.be/、shorts/、embed/），不是 YouTube 連結回傳 null */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** YouTube 內嵌播放器網址：自動播放、靜音、循環、不顯示控制列 */
export const youtubeEmbedUrl = (id: string) =>
  `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(id)}&controls=0&playsinline=1&rel=0`;
