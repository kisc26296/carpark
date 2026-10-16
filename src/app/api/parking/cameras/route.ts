import { listCameras, ParkingEntryError, setCameraRole } from "@/lib/parking/parking-entries";

export const dynamic = "force-dynamic";

// 列出攝影機與入口 / 出口設定：GET /api/parking/cameras
export async function GET() {
  try {
    return Response.json({ ok: true, items: await listCameras() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

// 指定攝影機是入口或出口：PUT /api/parking/cameras  body: { sn, role: "entry" | "exit" | null }
export async function PUT(request: Request) {
  let body: { sn?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  try {
    await setCameraRole(body.sn, body.role ?? null);
    return Response.json({ ok: true, items: await listCameras() });
  } catch (error) {
    return error instanceof ParkingEntryError
      ? Response.json({ ok: false, error: error.message }, { status: error.status })
      : Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status: 500 });
  }
}
