import { controlGate, GateCapacityError } from "@/lib/parking/gate-capacity";

// 開閘 / 關閘：POST /api/parking/gate  body: { role: "entry" | "exit", action?: "open" | "close" }
// 對指定為入口 / 出口的所有攝影機下發 MQTT Open / Close 命令；action 省略時為開閘
export async function POST(request: Request) {
  let body: { role?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  if (body.role !== "entry" && body.role !== "exit") {
    return Response.json({ ok: false, error: "role 必須是 entry / exit" }, { status: 400 });
  }
  const action = body.action ?? "open";
  if (action !== "open" && action !== "close") {
    return Response.json({ ok: false, error: "action 必須是 open / close" }, { status: 400 });
  }
  try {
    const results = await controlGate(body.role, action);
    return Response.json({ ok: results.every((r) => r.ok), results });
  } catch (error) {
    const status = error instanceof GateCapacityError ? error.status : 500;
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : action === "open" ? "開閘失敗" : "關閘失敗" },
      { status },
    );
  }
}
