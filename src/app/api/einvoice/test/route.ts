import {
  buildInvalidFields,
  buildIssueFields,
  buildSearchFields,
  callEzpay,
  EzpayError,
  getEzpayConfig,
  selfTest,
  type EzpayAction,
} from "@/lib/einvoice/ezpay";
import { getCurrentUser } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// ezPay 電子發票加值中心串接測試
//
// GET  /api/einvoice/test
//   → 設定狀態（不回傳金鑰本身）與離線自我檢查（加解密、手冊附件二的檢查碼範例）
//
// POST /api/einvoice/test
//   { action: "issue", category?: "B2C" | "B2B", buyerUBN?, buyerAddress?, totalAmt?: 100, itemName?: "停車費", buyerName?, buyerEmail?, carrierNum?, loveCode?, merchantOrderNo?, comment? }
//     開立應稅發票（金額含稅，預設 100 元停車費）。B2C 沒給載具與捐贈碼時索取紙本；B2B 必填統一編號、一律紙本
//   { action: "invalid", invoiceNumber: "AB12345678", invalidReason?: "測試作廢" }
//   { action: "search", invoiceNumber, randomNum }  或  { action: "search", merchantOrderNo, totalAmt }
//   → 送出的欄位（加密前）、平台原始回應、解析後的 Result 與檢查碼驗證結果
//
// 只限管理者使用（首頁「電子發票測試」）

/** 不是管理者時回傳錯誤回應 */
async function denyNonAdmin(): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "請先登入" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ ok: false, error: "只有管理者可以使用電子發票測試" }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await denyNonAdmin();
  if (denied) return denied;
  const { config, missing, problems } = getEzpayConfig();
  return Response.json({
    ok: true,
    configured: config !== null,
    env: process.env.EZPAY_INVOICE_ENV === "production" ? "production" : "test",
    merchantId: process.env.EZPAY_INVOICE_MERCHANT_ID?.trim() || null,
    missing,
    problems,
    selfTest: selfTest(),
  });
}

const BUILDERS: Record<EzpayAction, (body: Record<string, unknown>) => Record<string, string | number>> = {
  issue: buildIssueFields,
  invalid: buildInvalidFields,
  search: buildSearchFields,
};

export async function POST(request: Request) {
  const denied = await denyNonAdmin();
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const action = body.action as EzpayAction;
  if (!(action in BUILDERS)) {
    return Response.json({ ok: false, error: "action 必須是 issue / invalid / search" }, { status: 400 });
  }
  try {
    const result = await callEzpay(action, BUILDERS[action](body));
    return Response.json({ ok: result.status === "SUCCESS", ...result });
  } catch (error) {
    const status = error instanceof EzpayError ? error.status : 500;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "串接失敗" }, { status });
  }
}
