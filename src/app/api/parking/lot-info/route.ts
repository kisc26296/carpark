import { getParkingLotInfo, PARKING_LOT_NAME_MAX, saveParkingLotName } from "@/lib/parking/parking-lot";

export const dynamic = "force-dynamic";

// 停車場基本資料：GET 讀取；PUT body: { name } 修改停車場名稱（空字串代表清除，繳費機改顯示預設抬頭）
export async function GET() {
  try {
    return Response.json({ ok: true, info: await getParkingLotInfo() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length > PARKING_LOT_NAME_MAX) {
    return Response.json({ ok: false, error: `停車場名稱最多 ${PARKING_LOT_NAME_MAX} 個字` }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, info: await saveParkingLotName(name) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status: 500 });
  }
}
