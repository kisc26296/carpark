import { searchInsideVehicles } from "@/lib/parking/parking-entries";
import { SINGLE_CHARGE_CODE_PATTERN } from "@/lib/parking/rate-shared";
import { getRateSettings } from "@/lib/parking/rate-settings";

export const dynamic = "force-dynamic";

// 繳費機查詢：GET /api/parking/kiosk-query?code=1～4 位數字，或 ?all=1 列出全部場內車輛
// 1. 有場內車輛的車牌包含輸入的數字 → { kind: "vehicles", items }（和單次收費代碼撞號時以場內車輛為主）
// 2. 輸入 4 位數且是「費率設定」的單次收費代碼 → { kind: "charge", charge: { code, amount } }
// items 只有車號、進場時間與是否有照片；點選車輛後再呼叫 /api/parking/kiosk-payment 開始收款（伺服器計算應繳金額）
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const all = params.get("all") === "1";
  const code = all ? "" : (params.get("code")?.trim() ?? "");
  if (!all && !/^\d{1,4}$/.test(code)) {
    return Response.json({ ok: false, error: "請輸入 1～4 位數字" }, { status: 400 });
  }
  try {
    const vehicles = await searchInsideVehicles(code);
    if (vehicles.length > 0) {
      const items = vehicles.map(({ entry, hasImage }) => ({
        id: entry.id,
        plate: entry.plate,
        entryTime: entry.entryTime,
        hasImage,
      }));
      return Response.json({ ok: true, kind: "vehicles", items });
    }
    if (all) return Response.json({ ok: false, error: "目前場內沒有車輛" }, { status: 404 });
    if (SINGLE_CHARGE_CODE_PATTERN.test(code)) {
      const charge = (await getRateSettings()).singleCharges.find((s) => s.code === code);
      if (charge) return Response.json({ ok: true, kind: "charge", charge });
    }
    return Response.json({ ok: false, error: "查無此車輛或代碼" }, { status: 404 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "查詢失敗" }, { status: 500 });
  }
}
