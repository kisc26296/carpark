import { chooseInvoice, KioskPaymentError } from "@/lib/parking/kiosk-payment";

export const dynamic = "force-dynamic";

// 繳費完成後選擇發票開立方式：POST /api/parking/kiosk-invoice
//   body: { id: 收款 id, type: "print" | "carrier" | "ubn", carrierNum?: "/ABC+123", buyerUBN?: "12345678" }
// 只有這台繳費機目前這筆、已繳費完成的收款可以開立，一筆收款只開一張；開立失敗時可再送一次重試。
// 等 ezPay 回應後回傳收款狀態（session.invoice）。
export async function POST(request: Request) {
  let body: { id?: unknown; type?: unknown; carrierNum?: unknown; buyerUBN?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, session: await chooseInvoice(body.id, body) });
  } catch (error) {
    const status = error instanceof KioskPaymentError ? error.status : 500;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "發票開立失敗" }, { status });
  }
}
