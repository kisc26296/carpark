import { getPlatform } from "@/lib/parking/mqtt-platform";
import { listSimulators, startSimulator, stopSimulator } from "@/lib/parking/simulator";

export async function GET() {
  return Response.json({ simulators: listSimulators() });
}

// 啟動或停止模擬設備：body { action: "start" | "stop", sn }
export async function POST(request: Request) {
  let body: { action?: unknown; sn?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const sn = typeof body.sn === "string" ? body.sn.trim() : "";
  if (!sn) return Response.json({ ok: false, error: "缺少 sn" }, { status: 400 });

  try {
    if (body.action === "start") {
      // 確保平台已在訂閱，模擬設備上線時的 Conn 才不會漏接
      getPlatform();
      const info = await startSimulator(sn);
      return Response.json({ ok: true, simulator: info });
    }
    if (body.action === "stop") {
      const stopped = await stopSimulator(sn);
      return Response.json({ ok: true, stopped });
    }
    return Response.json({ ok: false, error: "action 必須是 start 或 stop" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失敗" },
      { status: 500 },
    );
  }
}
