import { findInsideByPlateSuffix } from "@/lib/parking/parking-entries";
import { calculateFee, SINGLE_CHARGE_CODE_PATTERN } from "@/lib/parking/rate-shared";
import { getRateSettings } from "@/lib/parking/rate-settings";

export const dynamic = "force-dynamic";

// 繳費機查詢：GET /api/parking/kiosk-query?code=1234
// 先找車牌後四碼相符的場內車輛（依費率設定算到現在的停車費）→ { kind: "vehicles", items }
// 沒有場內車輛才查「費率設定」的單次收費代碼 → { kind: "charge", charge: { code, amount } }
// 代碼和車牌後四碼撞號時以場內車輛為主
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!SINGLE_CHARGE_CODE_PATTERN.test(code)) {
    return Response.json({ ok: false, error: "請輸入 4 位數字" }, { status: 400 });
  }
  try {
    const [vehicles, settings] = await Promise.all([findInsideByPlateSuffix(code), getRateSettings()]);
    if (vehicles.length > 0) {
      const now = new Date();
      const items = vehicles.map((v) => {
        const fee = calculateFee(settings, new Date(v.entryTime), now);
        return { id: v.id, plate: v.plate, entryTime: v.entryTime, minutes: fee.minutes, amount: fee.total };
      });
      return Response.json({ ok: true, kind: "vehicles", items });
    }
    const charge = settings.singleCharges.find((s) => s.code === code);
    if (charge) return Response.json({ ok: true, kind: "charge", charge });
    return Response.json({ ok: false, error: "查無此車輛或代碼" }, { status: 404 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "查詢失敗" }, { status: 500 });
  }
}
