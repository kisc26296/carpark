import { cancelPayment, getPayment, KioskPaymentError, startPayment } from "@/lib/parking/kiosk-payment";
import { ParkingEntryError } from "@/lib/parking/parking-entries";

export const dynamic = "force-dynamic";

const errorResponse = (error: unknown, fallback: string) => {
  const status = error instanceof KioskPaymentError || error instanceof ParkingEntryError ? error.status : 500;
  return Response.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
};

// 繳費機開始收款：POST /api/parking/kiosk-payment  body: { entryId } 場內車輛 或 { code } 單次收費代碼
// 應繳金額由伺服器計算；回傳收款狀態（應繳、已投、倒數剩餘毫秒…）
export async function POST(request: Request) {
  let body: { entryId?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, session: await startPayment(body) });
  } catch (error) {
    return errorResponse(error, "開始收款失敗");
  }
}

// 查詢收款狀態：GET /api/parking/kiosk-payment?id=
export async function GET(request: Request) {
  try {
    return Response.json({ ok: true, session: getPayment(new URL(request.url).searchParams.get("id")) });
  } catch (error) {
    return errorResponse(error, "查詢失敗");
  }
}

// 取消收款並退還已投金額：DELETE /api/parking/kiosk-payment?id=
export async function DELETE(request: Request) {
  try {
    return Response.json({ ok: true, session: await cancelPayment(new URL(request.url).searchParams.get("id")) });
  } catch (error) {
    return errorResponse(error, "取消失敗");
  }
}
