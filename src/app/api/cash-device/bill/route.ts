import { getBillState, runBillAction, updateBillSettings } from "@/lib/cash-device/protocols/bill-acceptor";
import { BILL_TYPES, type BillAction, type BillSettings } from "@/lib/cash-device/shared";

export const dynamic = "force-dynamic";

const ACTIONS: BillAction[] = ["accept", "reject", "hold", "enable", "disable", "reset", "poll", "clearCredit"];

// 讀取紙鈔機狀態（Link、Escrow、Credit、面額設定）：GET /api/cash-device/bill
export async function GET() {
  return Response.json({ ok: true, state: await getBillState() });
}

// 紙鈔機操作：POST /api/cash-device/bill
// body: { action: "accept"|"reject"|"hold"|"enable"|"disable"|"reset"|"poll"|"clearCredit" }
//    或 { settings: { enabledTypes: number[], escrow: boolean } } 儲存允許收的面額與 Escrow 模式
export async function POST(request: Request) {
  let body: { action?: unknown; settings?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  try {
    if (body.settings !== undefined) {
      const raw = body.settings as Partial<BillSettings>;
      const enabledTypes = Array.isArray(raw?.enabledTypes)
        ? [...new Set(raw.enabledTypes.map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < BILL_TYPES.length)
        : null;
      if (!enabledTypes || typeof raw.escrow !== "boolean") {
        return Response.json({ ok: false, error: "settings 需要 enabledTypes（陣列）與 escrow（布林）" }, { status: 400 });
      }
      return Response.json({ ok: true, state: await updateBillSettings({ enabledTypes, escrow: raw.escrow }) });
    }

    if (!ACTIONS.includes(body.action as BillAction)) {
      return Response.json({ ok: false, error: `action 必須是 ${ACTIONS.join(" / ")}` }, { status: 400 });
    }
    return Response.json({ ok: true, state: await runBillAction(body.action as BillAction) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失敗", state: await getBillState() },
      { status: 500 },
    );
  }
}
