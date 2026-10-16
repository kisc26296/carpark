import { getConfig, saveConfig } from "@/lib/cash-device/config-store";
import { closeDevice, getStatuses, openDevice } from "@/lib/cash-device/serial-manager";
import { isCashDevice } from "@/lib/cash-device/shared";

// 連線或中斷設備：POST /api/cash-device/connect
// body: { device: "bill"|"coin"|"hopper", action: "open"|"close" }
// 用已儲存的設定開啟 COM port；連線成功會記住 autoConnect，伺服器重啟後自動連回
export async function POST(request: Request) {
  let body: { device?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const { device, action } = body;
  if (!isCashDevice(device)) {
    return Response.json({ ok: false, error: "device 必須是 bill / coin / hopper" }, { status: 400 });
  }
  if (action !== "open" && action !== "close") {
    return Response.json({ ok: false, error: "action 必須是 open / close" }, { status: 400 });
  }

  try {
    if (action === "open") {
      await openDevice(device, await getConfig(device));
      await saveConfig(device, { autoConnect: true });
    } else {
      await closeDevice(device);
      await saveConfig(device, { autoConnect: false });
    }
    return Response.json({ ok: true, statuses: getStatuses() });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失敗", statuses: getStatuses() },
      { status: 500 },
    );
  }
}
