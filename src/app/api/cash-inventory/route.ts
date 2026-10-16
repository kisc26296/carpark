import {
  CashInventoryError,
  getCashInventory,
  listCashInventoryLogs,
  startCashInventoryTracking,
  updateCashInventory,
} from "@/lib/parking/cash-inventory";
import type { CashInventoryAction } from "@/lib/parking/cash-inventory-shared";

export const dynamic = "force-dynamic";

const ACTIONS: CashInventoryAction[] = ["setCurrent", "setReserved", "refill", "clearCashBox"];

// 收找零紀錄：GET 目前數量、保留數量、收鈔機數量與最近的操作紀錄
export async function GET() {
  try {
    // 正常在伺服器啟動時就開始追蹤；開發模式重新載入後保險再呼叫一次（重複呼叫不會重複訂閱）
    await startCashInventoryTracking();
    const [inventory, logs] = await Promise.all([getCashInventory(), listCashInventoryLogs()]);
    return Response.json({ ok: true, inventory, logs });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

// POST body: { action: "setCurrent" | "setReserved", values: { 100, 50, 10, 5, 1 } } 修改目前 / 保留數量
//         或 { action: "refill" } 確定補幣（目前數量補到保留數量）、{ action: "clearCashBox" } 收鈔機歸零
export async function POST(request: Request) {
  let body: { action?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  if (!ACTIONS.includes(body.action as CashInventoryAction)) {
    return Response.json({ ok: false, error: `action 必須是 ${ACTIONS.join(" / ")}` }, { status: 400 });
  }
  try {
    const inventory = await updateCashInventory(body.action as CashInventoryAction, body.values);
    return Response.json({ ok: true, inventory, logs: await listCashInventoryLogs() });
  } catch (error) {
    const status = error instanceof CashInventoryError ? error.status : 500;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status });
  }
}
