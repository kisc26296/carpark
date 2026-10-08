import { encodeLineMessage } from "@/lib/parking/led-protocol";
import { sendCommand } from "@/lib/parking/mqtt-platform";

// 下發 LED 點陣顯示板訊息（透過 SerialData 轉送 RS485 位元組）
// body: { sn, address?, lines: string[4], color: 1|2|3, mode: "fixed"|"temporary", durationSec?, timeoutMs? }
// 每一行各自組成一個獨立的 RS485 命令帧（0x25 固定顯示 / 0x27 臨時訊息），依序下發。
export async function POST(request: Request) {
  let body: {
    sn?: unknown;
    address?: unknown;
    lines?: unknown;
    color?: unknown;
    mode?: unknown;
    durationSec?: unknown;
    timeoutMs?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const sn = typeof body.sn === "string" ? body.sn.trim() : "";
  if (!sn) return Response.json({ ok: false, error: "缺少 sn" }, { status: 400 });

  const rawLines = Array.isArray(body.lines) ? body.lines.map((l) => String(l ?? "")) : [];
  const lines = [0, 1, 2, 3].map((i) => rawLines[i] ?? "");

  const color = ([1, 2, 3] as const).includes(Number(body.color) as 1 | 2 | 3)
    ? (Number(body.color) as 1 | 2 | 3)
    : 1;
  const mode = body.mode === "temporary" ? "temporary" : "fixed";
  const durationSec = mode === "temporary" ? Math.min(255, Math.max(1, Number(body.durationSec) || 10)) : undefined;
  const address = Number.isFinite(Number(body.address)) && body.address !== undefined ? Number(body.address) : undefined;
  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 5000, 500), 30000);

  const results = [];

  for (let i = 0; i < 4; i++) {
    const text = lines[i].trim();
    const line = (i + 1) as 1 | 2 | 3 | 4;

    if (!text) {
      results.push({ line, skipped: true });
      continue;
    }

    const encoded = encodeLineMessage({ line, text, color, durationSec, address });

    if (encoded.overLimit) {
      results.push({
        line,
        ok: false,
        overLimit: true,
        contentBytes: encoded.contentBytes,
        hex: encoded.hex,
        error: `第 ${line} 行內容過長（GBK ${encoded.contentBytes} bytes，上限 60 bytes）`,
      });
      continue;
    }

    try {
      const sendResult = await sendCommand(
        sn,
        "SerialData",
        { serialData: [{ channel: 0, data: encoded.base64, len: encoded.frameBytes }] },
        timeoutMs,
      );
      results.push({
        line,
        mode: encoded.mode,
        contentBytes: encoded.contentBytes,
        hex: encoded.hex,
        ok: sendResult.status === "success" || sendResult.status === "sent",
        status: sendResult.status,
      });
    } catch (error) {
      results.push({
        line,
        mode: encoded.mode,
        contentBytes: encoded.contentBytes,
        hex: encoded.hex,
        ok: false,
        error: error instanceof Error ? error.message : "傳送失敗",
      });
    }
  }

  const ok = results.every((r) => r.skipped || r.ok);
  return Response.json({ ok, results });
}
