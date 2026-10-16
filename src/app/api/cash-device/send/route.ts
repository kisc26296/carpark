import { writeDevice } from "@/lib/cash-device/serial-manager";
import { isCashDevice, parseHex } from "@/lib/cash-device/shared";

// 送出原始資料給設備：POST /api/cash-device/send
// body: { device: "bill"|"coin"|"hopper", hex: "02 00 03 ..." }
// 各設備的具名指令等協定文件到了再加
export async function POST(request: Request) {
  let body: { device?: unknown; hex?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const { device } = body;
  if (!isCashDevice(device)) {
    return Response.json({ ok: false, error: "device 必須是 bill / coin / hopper" }, { status: 400 });
  }
  const bytes = typeof body.hex === "string" ? parseHex(body.hex) : null;
  if (!bytes) {
    return Response.json({ ok: false, error: "hex 格式錯誤，請輸入偶數個 16 進位字元，例如 02 00 03" }, { status: 400 });
  }

  try {
    await writeDevice(device, bytes);
    return Response.json({ ok: true, bytes: bytes.length });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "傳送失敗" },
      { status: 500 },
    );
  }
}
