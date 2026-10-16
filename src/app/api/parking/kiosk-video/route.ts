import { getKioskVideo, KioskVideoError, saveKioskVideoSettings } from "@/lib/parking/kiosk-video";

export const dynamic = "force-dynamic";

// 繳費機廣告影片設定
// GET：目前設定、影片檔是否存在、繳費機要播的內容（player）
// PUT body: { source: "file" | "url", filePath?, url? }：儲存設定（影片檔必須存在且是可播放的格式）
export async function GET() {
  try {
    return Response.json({ ok: true, video: await getKioskVideo() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: { source?: unknown; filePath?: unknown; url?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  try {
    await saveKioskVideoSettings(body);
    return Response.json({ ok: true, video: await getKioskVideo() });
  } catch (error) {
    const status = error instanceof KioskVideoError ? error.status : 500;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status });
  }
}
