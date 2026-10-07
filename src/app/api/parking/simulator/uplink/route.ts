import { UPLINK_COMMANDS } from "@/lib/parking/catalog";
import { getSimulator } from "@/lib/parking/simulator";
import { COLLECTIONS, getParkingDb } from "@/lib/parking/store";

const SUPPORTED = new Set(UPLINK_COMMANDS.map((c) => c.command));

/** 平台處理上行訊息與自動回覆所需的等待時間 */
const PROCESS_WAIT_MS = 1500;

// 讓模擬設備發出上行訊息到 upload/{sn}，回傳平台收到後的紀錄與自動回覆
// body: { sn, command, data? }
export async function POST(request: Request) {
  let body: { sn?: unknown; command?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const sn = typeof body.sn === "string" ? body.sn.trim() : "";
  const command = typeof body.command === "string" ? body.command : "";
  if (!sn) return Response.json({ ok: false, error: "缺少 sn" }, { status: 400 });
  if (!SUPPORTED.has(command)) {
    return Response.json({ ok: false, error: `不支援的上行訊息：${command}` }, { status: 400 });
  }
  const data =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : null;

  const device = getSimulator(sn);
  if (!device) {
    return Response.json({ ok: false, error: `模擬設備 ${sn} 尚未啟動` }, { status: 409 });
  }

  try {
    const sent = await device.publishUplink(command, data);
    await new Promise((resolve) => setTimeout(resolve, PROCESS_WAIT_MS));

    const db = await getParkingDb();
    const projection = { _id: 0, direction: 1, command: 1, requestId: 1, dataObject: 1, origin: 1, receivedAt: 1 };
    const guid = sent.data ? (JSON.parse(sent.data) as { guid?: unknown }).guid : undefined;
    const [platformLog, plateResult] = await Promise.all([
      db
        .collection(COLLECTIONS.messages)
        .find({ sn, requestId: sent.requestId }, { projection })
        .sort({ receivedAt: 1 })
        .toArray(),
      typeof guid === "string" && guid
        ? db.collection(COLLECTIONS.plateResults).findOne({ guid }, { projection: { raw: 0, image_base64: 0 } })
        : null,
    ]);

    return Response.json({
      ok: platformLog.some((m) => m.direction === "up"),
      sent,
      platformLog,
      plateResult,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "發送失敗" },
      { status: 500 },
    );
  }
}
