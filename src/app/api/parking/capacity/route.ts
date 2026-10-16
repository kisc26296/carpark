import { GateCapacityError, getCapacity, saveCapacity } from "@/lib/parking/gate-capacity";

export const dynamic = "force-dynamic";

// 讀取車位數：GET /api/parking/capacity → { max, remaining, inside, updatedAt }
// remaining = max − inside（場內車輛數），依進出場自動計算
export async function GET() {
  try {
    return Response.json({ ok: true, capacity: await getCapacity() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

// 修改最大車位數：PUT /api/parking/capacity  body: { max }
export async function PUT(request: Request) {
  let body: { max?: unknown };
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
