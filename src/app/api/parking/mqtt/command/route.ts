import { DOWNLINK_COMMANDS } from "@/lib/parking/catalog";
import { sendCommand } from "@/lib/parking/mqtt-platform";
import { COLLECTIONS, getParkingDb } from "@/lib/parking/store";

const SUPPORTED = new Set(DOWNLINK_COMMANDS.map((c) => c.command));

/** 設備回覆後還會再送出後續訊息的命令（例如軟觸發後的 Result），多等一下一起回傳 */
const FOLLOW_UP_WAIT_MS: Record<string, number> = {
  SoftTriggerCapture: 1000,
  EnableUpdate: 1500,
  ResetDevice: 1500,
};

// 下發 MQTT 命令到 download/{sn}，並等待設備 Receipt
// body: { sn, command, data?, timeoutMs? }
export async function POST(request: Request) {
  let body: { sn?: unknown; command?: unknown; data?: unknown; timeoutMs?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const sn = typeof body.sn === "string" ? body.sn.trim() : "";
  const command = typeof body.command === "string" ? body.command : "";
  if (!sn) return Response.json({ ok: false, error: "缺少 sn" }, { status: 400 });
  if (!SUPPORTED.has(command)) {
    return Response.json({ ok: false, error: `不支援的下行命令：${command}` }, { status: 400 });
  }
  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 5000, 500), 30000);

  try {
    const startedAt = new Date();
    const result = await sendCommand(sn, command, body.data ?? null, timeoutMs);

    const followUpWait = FOLLOW_UP_WAIT_MS[command];
    let followUps: unknown[] = [];
    if (followUpWait && result.reply) {
      await new Promise((resolve) => setTimeout(resolve, followUpWait));
      const db = await getParkingDb();
      followUps = await db
        .collection(COLLECTIONS.messages)
        .find(
          { sn, receivedAt: { $gte: startedAt }, requestId: { $ne: result.envelope.requestId } },
          { projection: { _id: 0, direction: 1, command: 1, requestId: 1, dataObject: 1, origin: 1 } },
        )
        .sort({ receivedAt: 1 })
        .toArray();
    }

    return Response.json({
      ok: result.status === "success" || result.status === "sent",
      status: result.status,
      elapsedMs: result.elapsedMs,
      sent: result.envelope,
      reply: result.reply,
      followUps,
    });
  } catch (error) {
    console.error("下發 MQTT 命令失敗:", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "下發失敗" },
      { status: 500 },
    );
  }
}
