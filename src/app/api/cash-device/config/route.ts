import { getAllConfigs, getConfig, saveConfig } from "@/lib/cash-device/config-store";
import { getStatuses, openDevice } from "@/lib/cash-device/serial-manager";
import {
  BAUD_RATES,
  CASH_DEVICE_LABELS,
  DATA_BITS,
  isCashDevice,
  PARITIES,
  STOP_BITS,
  type SerialSettings,
} from "@/lib/cash-device/shared";

export const dynamic = "force-dynamic";

// 讀取三台設備的設定與目前連線狀態：GET /api/cash-device/config
export async function GET() {
  try {
    return Response.json({ ok: true, configs: await getAllConfigs(), statuses: getStatuses() });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取設定失敗" },
      { status: 500 },
    );
  }
}

// 儲存某台設備的 COM port 與通訊參數：PUT /api/cash-device/config
// body: { device: "bill"|"coin"|"hopper", port, baudRate, dataBits, parity, stopBits }
// 設備正在連線中時，會用新參數重新連線
export async function PUT(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const { device } = body;
  if (!isCashDevice(device)) {
    return Response.json({ ok: false, error: "device 必須是 bill / coin / hopper" }, { status: 400 });
  }

  const settings: SerialSettings = {
    port: typeof body.port === "string" ? body.port.trim() : "",
    baudRate: Number(body.baudRate),
    dataBits: Number(body.dataBits) as SerialSettings["dataBits"],
    parity: body.parity as SerialSettings["parity"],
    stopBits: Number(body.stopBits) as SerialSettings["stopBits"],
  };
  if (!(BAUD_RATES as readonly number[]).includes(settings.baudRate))
    return Response.json({ ok: false, error: `baudRate 必須是 ${BAUD_RATES.join(" / ")}` }, { status: 400 });
  if (!(DATA_BITS as readonly number[]).includes(settings.dataBits))
    return Response.json({ ok: false, error: `dataBits 必須是 ${DATA_BITS.join(" / ")}` }, { status: 400 });
  if (!(PARITIES as readonly string[]).includes(settings.parity))
    return Response.json({ ok: false, error: `parity 必須是 ${PARITIES.join(" / ")}` }, { status: 400 });
  if (!(STOP_BITS as readonly number[]).includes(settings.stopBits))
    return Response.json({ ok: false, error: `stopBits 必須是 ${STOP_BITS.join(" / ")}` }, { status: 400 });

  try {
    if (settings.port) {
      const conflict = (await getAllConfigs()).find(
        (c) => c.device !== device && c.port.toUpperCase() === settings.port.toUpperCase(),
      );
      if (conflict) {
        return Response.json(
          { ok: false, error: `${settings.port} 已設定給${CASH_DEVICE_LABELS[conflict.device]}` },
          { status: 409 },
        );
      }
    }

    const config = await saveConfig(device, settings);

    // 連線中（含自動重連中）就用新參數重連；沒選 port 時不重連，保留原連線讓使用者自己按中斷
    const status = getStatuses().find((s) => s.device === device)!;
    let reconnectError: string | null = null;
    if (status.state !== "disconnected" && settings.port) {
      try {
        await openDevice(device, settings);
      } catch (error) {
        reconnectError = error instanceof Error ? error.message : "重新連線失敗";
        await saveConfig(device, { autoConnect: false });
      }
    }

    return Response.json({
      ok: reconnectError === null,
      error: reconnectError ?? undefined,
      config: reconnectError ? await getConfig(device) : config,
      statuses: getStatuses(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "儲存設定失敗" },
      { status: 500 },
    );
  }
}
