import { getConfig } from "@/lib/cash-device/config-store";
import { testDevice } from "@/lib/cash-device/serial-manager";
import { isCashDevice } from "@/lib/cash-device/shared";

// 設備連線測試：POST /api/cash-device/test
// body: { device, port? }；port 省略時用已儲存的 COM port，其餘通訊參數用該設備已儲存的設定
// 送出詢問狀態指令，1.5 秒內設備有正確回應就算連線正常
export async function POST(request: Request) {
  let body: { device?: unknown; port?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const { device } = body;
  if (!isCashDevice(device)) return Response.json({ ok: false, error: "device 不正確" }, { status: 400 });

  try {
    const config = await getConfig(device);
    const port = typeof body.port === "string" && body.port.trim() ? body.port.trim() : config.port;
    const result = await testDevice(device, { ...config, port });
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "測試失敗" }, { status: 500 });
  }
}
