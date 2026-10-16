import { getEntryImage, ParkingEntryError } from "@/lib/parking/parking-entries";

export const dynamic = "force-dynamic";

// 進場 / 出場照片：GET /api/parking/entries/image?id=<進場紀錄 id>&kind=entry|exit
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "exit" ? "exit" : "entry";
  try {
    const image = await getEntryImage(params.get("id"), kind);
    if (!image) return new Response("沒有照片", { status: 404 });
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        // 照片存檔後不會再變，讓瀏覽器快取，頁面每 5 秒重新整理清單時不必重抓
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    const status = error instanceof ParkingEntryError ? error.status : 500;
    return new Response(error instanceof Error ? error.message : "讀取照片失敗", { status });
  }
}
