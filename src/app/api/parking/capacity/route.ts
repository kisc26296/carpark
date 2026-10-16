import { GateCapacityError, getCapacity, saveCapacity } from "@/lib/parking/gate-capacity";

export const dynamic = "force-dynamic";

// 讀取車位數：GET /api/parking/capacity → { max, remaining, inside, adjust, updatedAt }
// remaining = max − inside（場內車輛數）+ adjust（手動調整值），隨進出場增減
export async function GET() {
  try {
    return Response.json({ ok: true, capacity: await getCapacity() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

// 修改車位數：PUT /api/parking/capacity  body: { max, remaining? }
// 有帶 remaining 時以它為準，換算成手動調整值存下
export async function PUT(request: Request) {
  let body: { max?: unknown; remaining?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, capacity: await saveCapacity(body) });
  } catch (error) {
    const status = error instanceof GateCapacityError ? error.status : 500;
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status });
  }
}
